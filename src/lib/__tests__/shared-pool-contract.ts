/**
 * shared-pool-contract.ts
 *
 * A shared test-contract for every BrowserPool implementation.
 *
 * Usage (in each pool's own test file):
 *
 *   import { testBrowserPoolContract } from './shared-pool-contract';
 *
 *   testBrowserPoolContract('GpmProfilePool', () =>
 *     new GpmProfilePool(fakeConfig, noopCb),
 *   );
 *
 * The factory is called ONCE per `describe` block, not per test case, so the
 * pool instance is shared across all contract tests.  Each individual test is
 * responsible for acquiring + releasing correctly so slots are returned.
 */

import { describe, test, expect } from 'bun:test';
import type { BrowserPool } from '../browser-pool';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Wait at most `ms` milliseconds for `pred` to become true. */
async function waitFor(pred: () => boolean, ms = 3000, interval = 50): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise(r => setTimeout(r, interval));
  }
}

// ── contract ─────────────────────────────────────────────────────────────────

/**
 * Run the shared BrowserPool contract tests.
 *
 * @param poolName  Human-readable name shown in the test title.
 * @param makePool  Factory called once to create the pool under test.
 *                  The factory may be async.
 */
export function testBrowserPoolContract(
  poolName: string,
  makePool: () => BrowserPool | Promise<BrowserPool>,
) {
  describe(`BrowserPool contract — ${poolName}`, () => {
    let pool: BrowserPool;

    // Resolve the pool once before the contract tests run.
    // Individual test files are responsible for setting up mocks BEFORE calling
    // testBrowserPoolContract so the factory sees the correct environment.
    const getPool = async () => {
      if (!pool) pool = await makePool();
      return pool;
    };

    // ── 1. Shape ──────────────────────────────────────────────────────────────

    test('exposes a non-empty type string', async () => {
      const p = await getPool();
      expect(typeof p.type).toBe('string');
      expect(p.type.length).toBeGreaterThan(0);
    });

    test('exposes a positive integer concurrency', async () => {
      const p = await getPool();
      expect(typeof p.concurrency).toBe('number');
      expect(Number.isInteger(p.concurrency)).toBe(true);
      expect(p.concurrency).toBeGreaterThan(0);
    });

    test('acquire() returns a promise', async () => {
      const p = await getPool();
      const result = p.acquire('test@example.com');
      expect(result).toBeInstanceOf(Promise);
      // Immediately release to avoid dangling handles.
      const handle = await result;
      await handle.release();
    });

    // ── 2. Handle shape ────────────────────────────────────────────────────────

    test('handle has a positive integer port', async () => {
      const p = await getPool();
      const handle = await p.acquire('port-test@example.com');
      try {
        expect(typeof handle.port).toBe('number');
        expect(Number.isInteger(handle.port)).toBe(true);
        expect(handle.port).toBeGreaterThan(0);
      } finally {
        await handle.release();
      }
    });

    test('handle.release is a function that returns a promise', async () => {
      const p = await getPool();
      const handle = await p.acquire('release-test@example.com');
      expect(typeof handle.release).toBe('function');
      const releaseResult = handle.release();
      expect(releaseResult).toBeInstanceOf(Promise);
      await releaseResult;
    });

    // ── 3. Proxy param is accepted ─────────────────────────────────────────────

    test('acquire() accepts an explicit proxy string without throwing', async () => {
      const p = await getPool();
      const handle = await p.acquire('proxy-test@example.com', 'proxy.host:8080:user:pass');
      try {
        expect(handle.port).toBeGreaterThan(0);
      } finally {
        await handle.release();
      }
    });

    test('acquire() accepts null proxy without throwing', async () => {
      const p = await getPool();
      const handle = await p.acquire('null-proxy@example.com', null);
      try {
        expect(handle.port).toBeGreaterThan(0);
      } finally {
        await handle.release();
      }
    });

    test('acquire() accepts undefined proxy without throwing', async () => {
      const p = await getPool();
      const handle = await p.acquire('undef-proxy@example.com', undefined);
      try {
        expect(handle.port).toBeGreaterThan(0);
      } finally {
        await handle.release();
      }
    });

    // ── 4. Slot management ────────────────────────────────────────────────────

    test('second acquire returns a different port from first', async () => {
      const p = await getPool();
      // Only viable when concurrency ≥ 2; skip silently otherwise.
      if (p.concurrency < 2) return;

      const h1 = await p.acquire('account-1@example.com');
      const h2 = await p.acquire('account-2@example.com');
      try {
        expect(h1.port).not.toBe(h2.port);
      } finally {
        await h1.release();
        await h2.release();
      }
    });

    test('slot is reusable after release', async () => {
      const p = await getPool();
      // Acquire + release, then acquire again — should not hang or throw.
      const h1 = await p.acquire('recycle@example.com');
      const port1 = h1.port;
      await h1.release();

      // Allow the pool to process the release.
      await new Promise(r => setTimeout(r, 50));

      const h2 = await p.acquire('recycle@example.com');
      try {
        // Port may or may not be reused, but must be valid.
        expect(h2.port).toBeGreaterThan(0);
        // For single-slot pools the same port should come back.
        if (p.concurrency === 1) {
          expect(h2.port).toBe(port1);
        }
      } finally {
        await h2.release();
      }
    });

    // ── 5. Concurrency ceiling ─────────────────────────────────────────────────

    test('does not exceed concurrency limit', async () => {
      const p = await getPool();
      const lim = p.concurrency;

      // Acquire all slots simultaneously.
      const handles = await Promise.all(
        Array.from({ length: lim }, (_, i) => p.acquire(`slot-${i}@example.com`)),
      );

      // Verify every port is unique.
      const ports = handles.map(h => h.port);
      const unique = new Set(ports);
      expect(unique.size).toBe(lim);

      // Verify the (lim+1)-th acquire is still pending (pool is full).
      let resolved = false;
      const extra = p.acquire('extra@example.com').then(h => {
        resolved = true;
        return h.release();
      });

      await new Promise(r => setTimeout(r, 100));
      expect(resolved).toBe(false); // still queued

      // Release one slot → extra should now resolve.
      await handles[0].release();
      await waitFor(() => resolved, 3000);
      expect(resolved).toBe(true);

      // Clean up remaining handles.
      await Promise.all(handles.slice(1).map(h => h.release()));
      await extra;
    });
  });
}
