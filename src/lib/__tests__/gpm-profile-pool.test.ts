/**
 * gpm-profile-pool.test.ts
 *
 * Tests GpmProfilePool in isolation.
 *
 * All external I/O is mocked:
 *   - GpmLoginClient  → mock module
 *   - fetch (CDP wait) → global override per test
 *
 * The contract tests (shared with every pool implementation) are imported and
 * re-used via `testBrowserPoolContract`.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { testBrowserPoolContract } from './shared-pool-contract';
import type { ApiResponse, Profile, PagedData, StartProfileResult } from '../gpm-login';

// ── Mock: pino-logger (silence all output) ────────────────────────────────────

mock.module('../pino-logger', () => {
  const child = () => logger;
  const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, child };
  return { createLogger: () => logger };
});

// ── GPM API mock helpers ───────────────────────────────────────────────────────

type GpmMocks = {
  listProfiles: ReturnType<typeof mock>;
  createProfile: ReturnType<typeof mock>;
  updateProfile: ReturnType<typeof mock>;
  startProfile:  ReturnType<typeof mock>;
  stopProfile:   ReturnType<typeof mock>;
  getVersions:   ReturnType<typeof mock>;
};

let gpmMocks: GpmMocks;

/**
 * Build a minimal Profile shape.  raw_proxy defaults to null (no proxy set).
 */
function makeProfile(id: string, name: string, raw_proxy: string | null = null): Profile {
  return {
    id, name, raw_proxy,
    group_id: null, browser_type: 1, browser_version: '120',
    os_type: 0, custom_user_agent: null, task_bar_title: null,
    webrtc_mode: null, fixed_webrtc_public_ip: '',
    geolocation_mode: null, canvas_mode: null, client_rect_mode: null,
    webgl_image_mode: null, webgl_metadata_mode: null, audio_mode: null,
    font_mode: null, timezone_base_on_ip: true, timezone: null,
    is_language_base_on_ip: true, fixed_language: null,
  };
}

function apiOk<T>(data: T): ApiResponse<T> {
  return { success: true, data, message: 'OK', sender: 'test' };
}
function apiFail(message = 'error'): ApiResponse<null> {
  return { success: false, data: null, message, sender: 'test' };
}

function pagedOf<T>(items: T[]): ApiResponse<PagedData<T>> {
  return apiOk<PagedData<T>>({
    current_page: 1, per_page: 50, total: items.length,
    last_page: 1, data: items,
  });
}

/** Make fetch always return an ok CDP response (so waitForCdp resolves). */
function mockCdpReady() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global.fetch = mock(async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://...' }), { status: 200 })) as any;
}

// ── Mock: GpmLoginClient module ────────────────────────────────────────────────

mock.module('../gpm-login', () => {
  // We capture a reference to the GpmMocks object that tests will control.
  // Each mock function forwards to the current gpmMocks entry so tests can
  // swap behaviour between calls.
  class GpmLoginClient {
    readonly profiles = {
      list:   (...a: unknown[]) => gpmMocks.listProfiles(...a),
      create: (...a: unknown[]) => gpmMocks.createProfile(...a),
      update: (...a: unknown[]) => gpmMocks.updateProfile(...a),
      start:  (...a: unknown[]) => gpmMocks.startProfile(...a),
      stop:   (...a: unknown[]) => gpmMocks.stopProfile(...a),
    };
    readonly browsers = {
      versions: (...a: unknown[]) => gpmMocks.getVersions(...a),
    };
  }
  return { GpmLoginClient };
});

// ── Shared config / pool factory ──────────────────────────────────────────────

const BASE_PORT = 19300;
const CONCURRENCY = 3;

const fakeConfig = {
  concurrency:        CONCURRENCY,
  baseCdpPort:        BASE_PORT,
  baseProxyPort:      10100,
  profileDir:         '/tmp/test-profiles',
  proxyHost:          'proxy.test',
  proxyUser:          'usr',
  proxyPass:          'pass',
  upstreamProxyBase:  8001,
  upstreamProxyRange: 99,
  chromePath:         undefined,
  gpmBaseUrl:         'http://127.0.0.1:9495',
};

function defaultGpmMocks(): GpmMocks {
  return {
    // By default: no profiles exist (empty list).
    listProfiles:   mock(async () => pagedOf<Profile>([])),
    // Create succeeds, returning a profile with a stable id.
    createProfile:  mock(async (_body: { name: string; raw_proxy: string }) =>
      apiOk(makeProfile('profile-1', _body.name, _body.raw_proxy ?? null)),
    ),
    updateProfile:  mock(async () => apiOk(makeProfile('profile-1', 'test', null))),
    // Start returns a remote_debugging_port so the CDP poller can stop.
    startProfile:   mock(async (id: string, opts: { remote_debugging_port?: number }) =>
      apiOk<StartProfileResult>({
        profile_id: id,
        driver_path: '',
        remote_debugging_port: opts?.remote_debugging_port ?? BASE_PORT,
        addition_info: null,
      }),
    ),
    stopProfile:    mock(async () => apiOk(null)),
    getVersions:    mock(async () => apiOk({ chromium: ['120.0.0.0'], firefox: [] })),
  };
}

// ── Lazy import after mocks are set up ────────────────────────────────────────

// We import the class lazily so the module mock is in place first.
const { GpmProfilePool } = await import('../gpm-profile-pool');

// ── Reset between tests ────────────────────────────────────────────────────────

beforeEach(() => {
  gpmMocks = defaultGpmMocks();
  mockCdpReady();
});

// ── Shared contract ────────────────────────────────────────────────────────────

testBrowserPoolContract('GpmProfilePool', () => {
  gpmMocks = defaultGpmMocks();
  mockCdpReady();
  return new GpmProfilePool(fakeConfig);
});

// ── GPM-specific: proxy selection ─────────────────────────────────────────────

describe('GpmProfilePool — proxy selection', () => {
  test('uses caller-supplied proxy when provided and profile does not exist yet', async () => {
    const pool = new GpmProfilePool(fakeConfig);
    const callerProxy = 'isp.host:9000:user:pass';

    const handle = await pool.acquire('new@example.com', callerProxy);
    await handle.release();

    // createProfile should have been called with the caller's proxy.
    expect(gpmMocks.createProfile).toHaveBeenCalledTimes(1);
    const createArg = (gpmMocks.createProfile.mock.calls[0] as [{ raw_proxy: string }])[0];
    expect(createArg.raw_proxy).toBe(callerProxy);
  });

  test('generates a proxy via hash when no proxy supplied and profile does not exist', async () => {
    const pool = new GpmProfilePool(fakeConfig);

    const handle = await pool.acquire('hashme@example.com');
    await handle.release();

    expect(gpmMocks.createProfile).toHaveBeenCalledTimes(1);
    const createArg = (gpmMocks.createProfile.mock.calls[0] as [{ raw_proxy: string }])[0];
    // The generated proxy should follow the pattern host:port:user:pass.
    expect(createArg.raw_proxy).toMatch(/^proxy\.test:\d+:usr:pass$/);
  });

  test('onProxyAssigned is called when proxy is auto-generated (no proxy provided)', async () => {
    const assigned: Array<{ email: string; proxy: string }> = [];
    const pool = new GpmProfilePool(
      fakeConfig,
      async (email, proxy) => { assigned.push({ email, proxy }); },
    );

    const handle = await pool.acquire('auto@example.com');
    await handle.release();

    expect(assigned).toHaveLength(1);
    expect(assigned[0].email).toBe('auto@example.com');
    expect(assigned[0].proxy).toMatch(/^proxy\.test:\d+:usr:pass$/);
  });

  test('onProxyAssigned is NOT called when caller supplies a proxy', async () => {
    const assigned: string[] = [];
    const pool = new GpmProfilePool(
      fakeConfig,
      async (_e, p) => { assigned.push(p); },
    );

    const handle = await pool.acquire('supplied@example.com', 'explicit:9000:u:p');
    await handle.release();

    expect(assigned).toHaveLength(0);
  });
});

// ── GPM-specific: proxy change detection ──────────────────────────────────────

describe('GpmProfilePool — proxy change detection', () => {
  const existingProfile = makeProfile('profile-existing', 'ggchecks::existing@example.com', 'old.host:8000:u:p');

  beforeEach(() => {
    // Profile already exists in GPM with old proxy.
    gpmMocks.listProfiles = mock(async () => pagedOf([existingProfile]));
  });

  test('calls gpm.profiles.update() when proxy has changed', async () => {
    const newProxy = 'new.host:9000:u:p';
    const pool = new GpmProfilePool(fakeConfig);

    const handle = await pool.acquire('existing@example.com', newProxy);
    await handle.release();

    expect(gpmMocks.updateProfile).toHaveBeenCalledTimes(1);
    const [id, body] = gpmMocks.updateProfile.mock.calls[0] as [string, { raw_proxy: string }];
    expect(id).toBe(existingProfile.id);
    expect(body.raw_proxy).toBe(newProxy);
  });

  test('does NOT call gpm.profiles.update() when proxy is unchanged', async () => {
    const sameProxy = existingProfile.raw_proxy!;
    const pool = new GpmProfilePool(fakeConfig);

    const handle = await pool.acquire('existing@example.com', sameProxy);
    await handle.release();

    expect(gpmMocks.updateProfile).not.toHaveBeenCalled();
  });

  test('onProxyChanged callback is fired when proxy changes', async () => {
    const changed: Array<{ email: string; proxy: string }> = [];
    const pool = new GpmProfilePool(
      fakeConfig,
      undefined,
      async (email, proxy) => { changed.push({ email, proxy }); },
    );
    const newProxy = 'changed.host:7777:u:p';

    const handle = await pool.acquire('existing@example.com', newProxy);
    await handle.release();

    expect(changed).toHaveLength(1);
    expect(changed[0].email).toBe('existing@example.com');
    expect(changed[0].proxy).toBe(newProxy);
  });

  test('onProxyChanged is NOT called when proxy is unchanged', async () => {
    const changed: string[] = [];
    const pool = new GpmProfilePool(
      fakeConfig,
      undefined,
      async (_e, p) => { changed.push(p); },
    );

    const handle = await pool.acquire('existing@example.com', existingProfile.raw_proxy);
    await handle.release();

    expect(changed).toHaveLength(0);
  });

  test('onProxyChanged is NOT called when proxy update API fails', async () => {
    gpmMocks.updateProfile = mock(async () => { throw new Error('GPM unavailable'); });
    const changed: string[] = [];
    const pool = new GpmProfilePool(
      fakeConfig,
      undefined,
      async (_e, p) => { changed.push(p); },
    );

    // Should NOT throw — GPM update failure is non-fatal.
    const handle = await pool.acquire('existing@example.com', 'different:9999:u:p');
    await handle.release();

    expect(changed).toHaveLength(0);
  });

  test('does NOT create a new profile when existing one is found', async () => {
    const pool = new GpmProfilePool(fakeConfig);

    const handle = await pool.acquire('existing@example.com', existingProfile.raw_proxy);
    await handle.release();

    expect(gpmMocks.createProfile).not.toHaveBeenCalled();
  });
});

// ── GPM-specific: profile creation ────────────────────────────────────────────

describe('GpmProfilePool — profile creation', () => {
  test('creates a new GPM profile when none exists', async () => {
    const pool = new GpmProfilePool(fakeConfig);
    const handle = await pool.acquire('brand-new@example.com', 'p:1:u:p');
    await handle.release();

    expect(gpmMocks.createProfile).toHaveBeenCalledTimes(1);
    const createArg = (gpmMocks.createProfile.mock.calls[0] as [{ name: string }])[0];
    expect(createArg.name).toBe('ggchecks::brand-new@example.com');
  });

  test('throws when GPM profile creation fails', async () => {
    gpmMocks.createProfile = mock(async () => apiFail('quota exceeded'));
    const pool = new GpmProfilePool(fakeConfig);

    await expect(pool.acquire('fail@example.com')).rejects.toThrow('quota exceeded');
  });

  test('caches created profile so subsequent acquire skips list API', async () => {
    const pool = new GpmProfilePool(fakeConfig);

    const h1 = await pool.acquire('cached@example.com');
    await h1.release();

    // Reset call counts.
    gpmMocks.listProfiles.mockClear();

    const h2 = await pool.acquire('cached@example.com');
    await h2.release();

    // Second acquire hits cache — no list API call needed.
    expect(gpmMocks.listProfiles).not.toHaveBeenCalled();
  });
});

// ── GPM-specific: GPM start / stop ────────────────────────────────────────────

describe('GpmProfilePool — browser lifecycle', () => {
  test('calls gpm.profiles.start() with the assigned CDP port', async () => {
    const pool = new GpmProfilePool(fakeConfig);
    const handle = await pool.acquire('lifecycle@example.com');
    await handle.release();

    expect(gpmMocks.startProfile).toHaveBeenCalledTimes(1);
    const [, startOpts] = gpmMocks.startProfile.mock.calls[0] as [string, { remote_debugging_port: number }];
    expect(startOpts.remote_debugging_port).toBeGreaterThanOrEqual(BASE_PORT);
    expect(startOpts.remote_debugging_port).toBeLessThan(BASE_PORT + CONCURRENCY);
  });

  test('calls gpm.profiles.stop() on release()', async () => {
    const pool = new GpmProfilePool(fakeConfig);
    const handle = await pool.acquire('stop-test@example.com');

    expect(gpmMocks.stopProfile).not.toHaveBeenCalled();
    await handle.release();
    expect(gpmMocks.stopProfile).toHaveBeenCalledTimes(1);
  });

  test('does not throw when gpm.profiles.stop() fails', async () => {
    gpmMocks.stopProfile = mock(async () => { throw new Error('GPM gone'); });
    const pool = new GpmProfilePool(fakeConfig);
    const handle = await pool.acquire('stop-fail@example.com');
    // Must not throw.
    await expect(handle.release()).resolves.toBeUndefined();
  });
});

// ── GPM-specific: version fetching ────────────────────────────────────────────

describe('GpmProfilePool — browser version', () => {
  test('passes browser_version to create when GPM versions API succeeds', async () => {
    gpmMocks.getVersions = mock(async () => apiOk({ chromium: ['130.0.0.0'], firefox: [] }));
    const pool = new GpmProfilePool(fakeConfig);

    const handle = await pool.acquire('version-test@example.com');
    await handle.release();

    const createArg = (gpmMocks.createProfile.mock.calls[0] as [{ browser_version?: string }])[0];
    expect(createArg.browser_version).toBe('130.0.0.0');
  });

  test('omits browser_version when versions API fails', async () => {
    gpmMocks.getVersions = mock(async () => { throw new Error('offline'); });
    const pool = new GpmProfilePool(fakeConfig);

    const handle = await pool.acquire('no-version@example.com');
    await handle.release();

    const createArg = (gpmMocks.createProfile.mock.calls[0] as [Record<string, unknown>])[0];
    expect(createArg.browser_version).toBeUndefined();
  });
});
