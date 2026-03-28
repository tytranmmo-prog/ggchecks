/**
 * browser-pool.ts
 *
 * Shared protocol (interface) for Chrome pool managers.
 *
 * Implementations:
 *  - chrome-pool.ts          — PersistentChromePool  (Chrome stays alive between checks)
 *  - chrome-profile-pool.ts  — CachedProfilePool     (profile dir per email, session reused)
 *
 * Pool selection is a RUNTIME decision — callers pass a PoolType directly.
 * The factory keeps one singleton instance per type so persistent Chrome
 * instances are reused across requests while ephemeral ones are independent.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** Discriminated union of all pool modes the UI can select. */
export type PoolType = 'ephemeral' | 'persistent';

/** Returned by `BrowserPool.acquire()`. */
export interface BrowserHandle {
  /** CDP remote-debugging port the Chrome instance is listening on. */
  port: number;

  /**
   * Release this slot back to the pool.
   * Kills the Chrome process + proxy sidecar. The profile directory is
   * intentionally preserved so the next run reuses the cached session.
   * Always call from a `finally` block.
   */
  release: () => Promise<void>;
}

/** Common interface every pool must satisfy. */
export interface BrowserPool {
  readonly type: PoolType;

  /** Maximum number of simultaneous Chrome instances. */
  readonly concurrency: number;

  /**
   * Wait for a free slot, then launch Chrome with a profile tied to `email`.
   * Resolves with a handle once Chrome's CDP endpoint is ready.
   *
   * The profile directory is preserved across runs so the Google session
   * (cookies, storage) is cached and login is not repeated unnecessarily.
   */
  acquire(email: string): Promise<BrowserHandle>;
}

// ─── Runtime factory ──────────────────────────────────────────────────────────

// One singleton per pool type so persistent Chrome instances survive across
// requests. Ephemeral pool state is trivial (just a semaphore counter) so
// sharing the instance is fine there too.
const _instances = new Map<PoolType, BrowserPool>();

/**
 * Returns the singleton pool for the given type.
 * Defaults to `'ephemeral'` if no type is supplied.
 *
 * This is called at request time so the UI can choose the pool on the fly:
 *
 *   const pool = await getPool('persistent');
 *   const pool = await getPool();              // → ephemeral (default)
 */
export interface PoolConfig {
  concurrency: number;
  baseCdpPort: number;
  baseProxyPort: number;
  profileDir: string;
  proxyHost: string;
  proxyUser: string;
  proxyPass: string;
  upstreamProxyBase: number;
  upstreamProxyRange: number;
  chromePath: string | undefined;
}

export function loadPoolConfig(): PoolConfig {
  const { getConfig, getConfigNumber } = require('./config');
  return {
    concurrency: getConfigNumber('BULK_CONCURRENCY', 10),
    baseCdpPort: parseInt(process.env.BULK_BASE_PORT || '9300', 10),
    baseProxyPort: parseInt(process.env.BULK_BASE_PROXY_PORT || '10100', 10),
    profileDir: process.env.BULK_PROFILE_DIR || '/tmp/ggchecks-profiles',
    proxyHost: getConfig('OXYLABS_PROXY_HOST') || 'isp.oxylabs.io',
    proxyUser: getConfig('OXYLABS_PROXY_USER') || '',
    proxyPass: getConfig('OXYLABS_PROXY_PASS') || '',
    upstreamProxyBase: parseInt(process.env.OXYLABS_BASE_PORT || '8001', 10),
    upstreamProxyRange: parseInt(process.env.OXYLABS_PORT_RANGE || '99', 10),
    chromePath: process.env.CHROME_PATH,
  };
}

export async function getPool(type: PoolType = 'ephemeral'): Promise<BrowserPool> {
  if (_instances.has(type)) return _instances.get(type)!;

  let pool: BrowserPool;
  const config = loadPoolConfig();

  if (type === 'persistent') {
    const { PersistentChromePool } = await import('./chrome-pool');
    pool = new PersistentChromePool(config);
  } else {
    const { CachedProfilePool } = await import('./chrome-profile-pool');
    pool = new CachedProfilePool(config);
  }

  _instances.set(type, pool);
  return pool;
}
