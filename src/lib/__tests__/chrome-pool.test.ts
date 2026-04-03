/**
 * chrome-pool.test.ts
 *
 * Tests PersistentChromePool in isolation.
 *
 * PersistentChromePool differs from the others:
 *   - Slots are long-lived: Chrome is only spawned if NOT already running.
 *   - `release()` just marks the slot free; it does NOT kill Chrome.
 *   - The concurrency gate is a polling loop, not p-limit.
 *
 * Mocked external dependencies:
 *   - child_process.spawn → inert FakeChild (Chrome "already running" path
 *     is covered by making fetch return 200 immediately)
 *   - fetch (CDP check)   → global override
 *   - pino-logger         → silenced
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { EventEmitter } from 'events';
import { testBrowserPoolContract } from './shared-pool-contract';

// ── Silence logger ────────────────────────────────────────────────────────────

mock.module('../pino-logger', () => {
  const noop = () => {};
  const logger: Record<string, unknown> = { debug: noop, info: noop, warn: noop, error: noop };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

// ── Mock child_process ────────────────────────────────────────────────────────

class FakeChild extends EventEmitter {
  pid    = Math.floor(Math.random() * 100000);
  killed = false;
  unref() {}
  kill() { this.killed = true; }
}

const spawnedChildren: FakeChild[] = [];

mock.module('child_process', () => ({
  spawn: mock((..._args: unknown[]): FakeChild => {
    const child = new FakeChild();
    spawnedChildren.push(child);
    return child;
  }),
  ChildProcess: FakeChild,
}));

// ── Mock config ────────────────────────────────────────────────────────────────

mock.module('../config', () => ({
  getConfig:       mock((_k: string) => undefined),
  getConfigNumber: mock((_k: string, def: number) => def),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE_PORT   = 19500;
const CONCURRENCY = 2;

const fakeConfig = {
  concurrency:        CONCURRENCY,
  baseCdpPort:        BASE_PORT,
  baseProxyPort:      10300,
  profileDir:         '/tmp/test-persistent',
  proxyHost:          'isp.test',
  proxyUser:          'u',
  proxyPass:          'p',
  upstreamProxyBase:  8001,
  upstreamProxyRange: 99,
  chromePath:         '/usr/bin/fake-chrome',
  gpmBaseUrl:         '',
};

/**
 * Make the first fetch call return ok → `ensureChrome` thinks Chrome is
 * already running and skips the spawn step.
 */
function mockChromeAlreadyRunning() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = mock(async () => new Response(JSON.stringify({}), { status: 200 })) as any;
}

/**
 * Make fetch return a non-ok response for N calls, then ok.
 * Simulates Chrome startup delay (forces ensureChrome to spawn Chrome).
 */
function mockChromeStartsAfter(failCount: number) {
  let calls = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = mock(async () => {
    calls++;
    if (calls <= failCount) {
      // Simulate "not yet up"; fetch itself succeeds but status is not ok.
      return new Response('', { status: 503 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

// ── Lazy import ────────────────────────────────────────────────────────────────

const { PersistentChromePool } = await import('../chrome-pool');

// ── Reset ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  spawnedChildren.length = 0;
  mockChromeAlreadyRunning();
});

// ── Contract ──────────────────────────────────────────────────────────────────

testBrowserPoolContract('PersistentChromePool', () => {
  mockChromeAlreadyRunning();
  return new PersistentChromePool(fakeConfig);
});

// ── PersistentChromePool-specific ─────────────────────────────────────────────

describe('PersistentChromePool — Chrome lifecycle', () => {
  test('does NOT spawn Chrome when it is already running (fetch → 200)', async () => {
    // fetch returns ok immediately → ensureChrome exits the first check path.
    mockChromeAlreadyRunning();
    const pool = new PersistentChromePool(fakeConfig);

    const handle = await pool.acquire('no-spawn@example.com');
    await handle.release();

    expect(spawnedChildren.length).toBe(0);
  });

  test('spawns Chrome + proxy when Chrome is not yet running', async () => {
    // First fetch call fails (not running), second succeeds (Chrome started).
    mockChromeStartsAfter(3);
    const pool = new PersistentChromePool(fakeConfig);

    const handle = await pool.acquire('spawn-me@example.com');
    await handle.release();

    // Exactly 2 spawns: proxy sidecar + Chrome.
    expect(spawnedChildren.length).toBe(2);
  });

  test('release() does NOT kill Chrome (persistent pool keeps browser alive)', async () => {
    mockChromeStartsAfter(2);
    const pool = new PersistentChromePool(fakeConfig);

    const handle = await pool.acquire('persistent@example.com');
    await handle.release();

    // None of the spawned children should be killed.
    for (const child of spawnedChildren) {
      expect(child.killed).toBe(false);
    }
  });
});

describe('PersistentChromePool — proxy param ignored', () => {
  test('accepts and silently ignores a caller-supplied proxy', async () => {
    const pool = new PersistentChromePool(fakeConfig);
    // Should not throw.
    const handle = await pool.acquire('ignored@example.com', 'any:proxy:u:p');
    await handle.release();
  });
});

describe('PersistentChromePool — slot assignment', () => {
  test('port is always within [baseCdpPort, baseCdpPort + concurrency)', async () => {
    const pool = new PersistentChromePool(fakeConfig);
    const h1 = await pool.acquire('range-a@example.com');
    const h2 = await pool.acquire('range-b@example.com');

    expect(h1.port).toBeGreaterThanOrEqual(BASE_PORT);
    expect(h1.port).toBeLessThan(BASE_PORT + CONCURRENCY);
    expect(h2.port).toBeGreaterThanOrEqual(BASE_PORT);
    expect(h2.port).toBeLessThan(BASE_PORT + CONCURRENCY);

    await h1.release();
    await h2.release();
  });

  test('slot is free again after release (no slot leak)', async () => {
    const pool = new PersistentChromePool(fakeConfig);

    // Exhaust both slots.
    const h1 = await pool.acquire('leak-a@example.com');
    const h2 = await pool.acquire('leak-b@example.com');

    // Release one slot.
    await h1.release();

    // A third acquire should now succeed without hanging.
    const h3 = await pool.acquire('leak-c@example.com');
    expect(h3.port).toBe(h1.port); // same slot reused

    await h2.release();
    await h3.release();
  });
});
