/**
 * chrome-profile-pool.test.ts
 *
 * Tests CachedProfilePool in isolation.
 *
 * Mocked external dependencies:
 *   - child_process.spawn  → returns a fake ChildProcess that never really starts
 *   - fs/promises.mkdir    → no-op
 *   - fetch (CDP poll)     → global override; replies ok immediately
 *   - pino-logger          → silenced
 */

import { describe, test, expect, mock, beforeEach, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import { testBrowserPoolContract } from './shared-pool-contract';

// ── Silence logger ────────────────────────────────────────────────────────────

mock.module('../pino-logger', () => {
  const noop = () => {};
  const logger: Record<string, unknown> = { debug: noop, info: noop, warn: noop, error: noop };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

// ── Mock child_process.spawn ──────────────────────────────────────────────────

/**
 * A minimal EventEmitter that satisfies the ChildProcess contract.
 * We track every instance so tests can inspect call arguments.
 */
class FakeChild extends EventEmitter {
  pid = Math.floor(Math.random() * 100000);
  killed = false;
  stdin  = null;
  stdout = null;
  stderr = null;
  /** Spawn arguments captured at creation time for test assertions. */
  spawnCmd = '';
  spawnArgs: string[] = [];
  kill() { this.killed = true; }
  unref() {}
}

const spawnedChildren: FakeChild[] = [];
let spawnMock: ReturnType<typeof mock>;

mock.module('child_process', () => {
  spawnMock = mock((cmd: string, args: string[]): FakeChild => {
    const child = new FakeChild();
    child.spawnCmd  = cmd;
    child.spawnArgs = args ?? [];
    spawnedChildren.push(child);
    return child;
  });
  return { spawn: spawnMock, ChildProcess: FakeChild };
});

// ── Mock fs/promises ──────────────────────────────────────────────────────────

mock.module('fs/promises', () => ({
  mkdir: mock(async () => undefined),
}));

// ── Mock config calls ─────────────────────────────────────────────────────────

mock.module('../config', () => ({
  getConfig:       mock((_k: string) => undefined),
  getConfigNumber: mock((_k: string, def: number) => def),
}));

// ── Shared config ──────────────────────────────────────────────────────────────

const BASE_PORT = 19400;
const CONCURRENCY = 2;

const fakeConfig = {
  concurrency:        CONCURRENCY,
  baseCdpPort:        BASE_PORT,
  baseProxyPort:      10200,
  profileDir:         '/tmp/test-chrome-profiles',
  proxyHost:          'isp.test',
  proxyUser:          'u',
  proxyPass:          'p',
  upstreamProxyBase:  8001,
  upstreamProxyRange: 99,
  chromePath:         '/usr/bin/fake-chrome',
  gpmBaseUrl:         '',
};

/** Make fetch immediately return a 200 so waitForCdp resolves after first attempt. */
function mockCdpReady() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = mock(async () => new Response(JSON.stringify({}), { status: 200 })) as any;
}

// ── Lazy import ────────────────────────────────────────────────────────────────

const { CachedProfilePool } = await import('../chrome-profile-pool');

// ── Reset ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  spawnedChildren.length = 0;
  spawnMock?.mockClear();
  mockCdpReady();
});

// ── Contract ──────────────────────────────────────────────────────────────────

testBrowserPoolContract('CachedProfilePool', () => {
  mockCdpReady();
  return new CachedProfilePool(fakeConfig);
});

// ── CachedProfilePool-specific ────────────────────────────────────────────────

describe('CachedProfilePool — spawn behaviour', () => {
  test('spawns exactly two child processes per acquire (proxy sidecar + Chrome)', async () => {
    const pool = new CachedProfilePool(fakeConfig);
    const handle = await pool.acquire('spawn-test@example.com');
    await handle.release();

    // spawn called twice: proxy helper + Chrome
    expect(spawnedChildren.length).toBe(2);
  });

  test('Chrome is spawned with --remote-debugging-port matching handle.port', async () => {
    const pool = new CachedProfilePool(fakeConfig);
    const handle = await pool.acquire('port-check@example.com');

    // spawnedChildren[1] is Chrome (index 0 is the proxy sidecar).
    const chromeChild = spawnedChildren[1];
    const portArg = chromeChild.spawnArgs.find(a => a.startsWith('--remote-debugging-port='))!;
    expect(portArg).toBeDefined();
    expect(parseInt(portArg.split('=')[1], 10)).toBe(handle.port);

    await handle.release();
  });

  test('Chrome is spawned with --user-data-dir containing the email', async () => {
    const pool = new CachedProfilePool(fakeConfig);
    const handle = await pool.acquire('userdir@example.com');

    const chromeChild = spawnedChildren[1];
    const udArg = chromeChild.spawnArgs.find(a => a.startsWith('--user-data-dir='))!;
    expect(udArg).toBeDefined();
    // emailToSafeName('userdir@example.com') → 'userdir_at_example.com'
    expect(udArg).toContain('userdir_at_example.com');

    await handle.release();
  });

  test('release() terminates both child processes', async () => {
    const pool = new CachedProfilePool(fakeConfig);

    // Track process.kill calls to verify safeKill is invoked.
    const killedPids: number[] = [];
    const origKill = process.kill.bind(process);
    process.kill = (pid: number, signal?: string | number) => {
      killedPids.push(pid);
      return origKill(pid, signal as NodeJS.Signals);
    };

    const handle = await pool.acquire('kill-test@example.com');
    const [proxy, chrome] = spawnedChildren;

    expect(killedPids).not.toContain(proxy.pid);
    expect(killedPids).not.toContain(chrome.pid);

    try {
      await handle.release();
    } finally {
      process.kill = origKill;
    }

    // safeKill calls process.kill with each child's PID.
    expect(killedPids).toContain(proxy.pid);
    expect(killedPids).toContain(chrome.pid);
  });
});

describe('CachedProfilePool — proxy param ignored', () => {
  test('ignores caller-supplied proxy (manages its own sidecar)', async () => {
    const pool = new CachedProfilePool(fakeConfig);
    // Should not throw regardless of the proxy value.
    const handle = await pool.acquire('ignored@example.com', 'some:proxy:value');
    await handle.release();
    // spawn is still called twice — proxy sidecar + Chrome.
    expect(spawnedChildren.length).toBe(2);
  });
});

describe('CachedProfilePool — slot management', () => {
  test('each port is derived from baseCdpPort', async () => {
    const pool = new CachedProfilePool(fakeConfig);
    const h1 = await pool.acquire('slot-a@example.com');
    const h2 = await pool.acquire('slot-b@example.com');

    expect([BASE_PORT, BASE_PORT + 1]).toContain(h1.port);
    expect([BASE_PORT, BASE_PORT + 1]).toContain(h2.port);
    expect(h1.port).not.toBe(h2.port);

    await h1.release();
    await h2.release();
  });
});
