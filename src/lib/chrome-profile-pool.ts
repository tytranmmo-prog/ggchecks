/**
 * chrome-profile-pool.ts  —  CachedProfilePool
 *
 * Implements BrowserPool where each account gets its own Chrome profile
 * directory derived from the account email. The directory persists across
 * runs so Google session cookies, local storage and any cached auth tokens
 * are reused on subsequent checks — avoiding a full login every time.
 *
 * On release() Chrome and the proxy sidecar are killed but the profile
 * directory is intentionally left intact.
 *
 * Concurrency is managed by `p-limit` (npm) instead of a hand-rolled semaphore.
 * The limiter wraps a deferred promise that resolves only when release() is called,
 * so the slot stays occupied for the full duration of the check.
 *
 * Profile root: process.env.BULK_PROFILE_DIR  (default /tmp/ggchecks-profiles)
 *
 * Implements: BrowserPool (browser-pool.ts)
 */

import pLimit               from 'p-limit';
import { spawn, ChildProcess } from 'child_process';
import { join }                from 'path';
import { mkdir }               from 'fs/promises';
import type { BrowserHandle, BrowserPool, PoolType } from './browser-pool';

import { getConfig, getConfigNumber } from './config';
import type { PoolConfig } from './browser-pool';

// ─── Email → profile dir ──────────────────────────────────────────────────────

/**
 * Derive a safe filesystem name from an email address.
 * e.g. "foo@bar.com" → "foo_at_bar.com"
 */
function emailToSafeName(email: string): string {
  return email
    .toLowerCase()
    .replace(/@/g, '_at_')
    .replace(/[^a-z0-9._-]/g, '_');
}

/** Absolute path to the persistent profile for this email. */
export function profileDirFor(email: string, config: PoolConfig): string {
  return join(config.profileDir, emailToSafeName(email));
}

// ─── Chrome path helper ───────────────────────────────────────────────────────

export function getChromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin')
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32')
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return '/usr/bin/google-chrome';
}

// ─── BrowserPool implementation ───────────────────────────────────────────────

export class CachedProfilePool implements BrowserPool {
  readonly type: PoolType = 'ephemeral';
  readonly concurrency: number;
  private readonly config: PoolConfig;

  // p-limit limiter — the single source of truth for concurrency.
  // Each acquire() schedules one "task" that stays in-flight until release() resolves.
  private readonly limit: ReturnType<typeof pLimit>;

  // Port-slot tracking: which slot indices are currently occupied.
  // Guaranteed to never exceed CONCURRENCY because the limiter gates entry.
  private readonly usedSlots = new Set<number>();
  private slotCounter = 0;

  constructor(config: PoolConfig) {
    this.config = config;
    this.concurrency = config.concurrency;
    this.limit = pLimit(this.concurrency);
  }

  private nextFreeSlot(): number {
    for (let i = 0; i < this.concurrency; i++) {
      const candidate = (this.slotCounter + i) % this.concurrency;
      if (!this.usedSlots.has(candidate)) {
        this.slotCounter = (candidate + 1) % this.concurrency;
        this.usedSlots.add(candidate);
        return candidate;
      }
    }
    // Should never happen — limiter guarantees at most CONCURRENCY active tasks.
    throw new Error('[CachedProfilePool] no free slot despite limiter allow');
  }

  // ── acquire ────────────────────────────────────────────────────────────────

  acquire(email: string): Promise<BrowserHandle> {
    // We create a deferred promise that only resolves when release() is called.
    // p-limit's task wraps this deferred, so the concurrency slot stays occupied
    // for the full duration of the Chrome session — not just during startup.
    let resolveDeferred!: () => void;
    const deferred = new Promise<void>(res => { resolveDeferred = res; });

    // This promise resolves with the BrowserHandle once Chrome is ready.
    // The outer deferred keeps the p-limit slot occupied until release() is called.
    let handleResolve!: (h: BrowserHandle) => void;
    let handleReject!:  (e: unknown) => void;
    const handlePromise = new Promise<BrowserHandle>((res, rej) => {
      handleResolve = res;
      handleReject  = rej;
    });

    this.limit(async () => {
      let slotIndex = -1;
      let proxyChild: ChildProcess | undefined;
      let chromeChild: ChildProcess | undefined;

      try {
        slotIndex = this.nextFreeSlot();

        const cdpPort    = this.config.baseCdpPort   + slotIndex;
        const localProxy = this.config.baseProxyPort + slotIndex;
        const upstreamPx = this.config.upstreamProxyBase + (slotIndex % this.config.upstreamProxyRange);

        // 1. Spin up local unauthenticated proxy
        const proxyHelper = join(process.cwd(), 'src', 'lib', 'run-proxy.js');
        proxyChild = spawn(
          'node',
          [proxyHelper, String(localProxy), String(upstreamPx)],
          {
            stdio: 'ignore',
            env: {
              ...process.env,
              OXYLABS_PROXY_HOST: this.config.proxyHost,
              OXYLABS_PROXY_USER: this.config.proxyUser,
              OXYLABS_PROXY_PASS: this.config.proxyPass,
            },
          },
        );

        // Give proxy a moment to bind
        await sleep(800);

        // 2. Ensure the persistent profile directory exists
        const profileDir = profileDirFor(email, this.config);
        await mkdir(profileDir, { recursive: true });

        // 3. Launch Chrome
        chromeChild = spawn(
          getChromePath(),
          [
            `--user-data-dir=${profileDir}`,
            `--remote-debugging-port=${cdpPort}`,
            '--remote-allow-origins=*',
            `--proxy-server=http://127.0.0.1:${localProxy}`,
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
          ],
          { stdio: 'ignore' },
        );

        // 4. Wait for CDP to become available
        await waitForCdp(cdpPort);

        // 5. Expose the handle to the caller and wait for them to call release()
        const release = async (): Promise<void> => {
          safeKill(chromeChild!);
          safeKill(proxyChild!);
          await sleep(300); // let OS release file locks
          // Profile dir preserved — session cache survives across runs.
          this.usedSlots.delete(slotIndex);
          console.debug(
            `[CachedProfilePool] slot ${slotIndex} released` +
            ` | active=${this.limit.activeCount} pending=${this.limit.pendingCount}`,
          );
          resolveDeferred(); // unblocks the p-limit task → frees the slot
        };

        handleResolve({ port: cdpPort, release });
      } catch (err) {
        // Startup failed — clean up, free the slot, propagate the error.
        if (chromeChild) safeKill(chromeChild);
        if (proxyChild)  safeKill(proxyChild);
        if (slotIndex >= 0) this.usedSlots.delete(slotIndex);
        handleReject(err);
        resolveDeferred(); // still need to unblock p-limit
      }

      // Keep this p-limit task alive until release() (or error) resolves the deferred.
      await deferred;
    });

    return handlePromise;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function safeKill(child: ChildProcess): void {
  try {
    if (!child.killed && child.pid) process.kill(child.pid, 'SIGTERM');
  } catch { /* already gone */ }
}

async function waitForCdp(port: number, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await sleep(500);
    try {
      const r = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return;
    } catch { /* still starting */ }
  }
  throw new Error(`Chrome on port ${port} did not start within ${(attempts * 500) / 1000}s`);
}
