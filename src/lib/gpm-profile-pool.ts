/**
 * gpm-profile-pool.ts  —  GpmProfilePool
 *
 * Implements BrowserPool where each account email gets its own GPMLogin Global
 * browser profile. Unlike CachedProfilePool (which spawns Chrome directly),
 * this pool delegates ALL browser lifecycle management to GPMLogin Global:
 *
 *   acquire(email):
 *     1. Find the GPM profile by name == email (paginated search).
 *     2. If not found, auto-create it with a proxy attached.
 *     3. Call gpm.profiles.start(id) → GPMLogin opens a real Chromium window.
 *     4. Poll the returned CDP port until the browser is ready.
 *     5. Return { port, release } to the caller.
 *
 *   release():
 *     - Calls gpm.profiles.stop(id) → GPMLogin closes the browser process.
 *     - Profile data (cookies, fingerprint) stays in GPMLogin for next run.
 *
 * Log feature tag: 'gpm-pool'
 * Per-account context: all log calls inside acquire() carry { email } via child().
 *
 * Implements: BrowserPool (browser-pool.ts)
 */

import pLimit from 'p-limit';
import type { BrowserHandle, BrowserPool, PoolConfig, PoolType } from './browser-pool';
import { GpmLoginClient } from './gpm-login';
import type { Profile } from './gpm-login';
import type { ILogger } from './logger';
import { createLogger } from './pino-logger';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Profile name prefix so GPM-managed profiles are recognisable in the UI. */
const PROFILE_PREFIX = 'ggchecks::';

/** Feature-scoped logger — all child loggers inherit the 'gpm-pool' feature tag. */
const log = createLogger('gpm-pool');

// ─── GpmProfilePool ───────────────────────────────────────────────────────────

export class GpmProfilePool implements BrowserPool {
  readonly type: PoolType = 'gpm';
  readonly concurrency: number;

  private readonly config: PoolConfig;
  private readonly gpm: GpmLoginClient;
  private readonly limit: ReturnType<typeof pLimit>;

  /**
   * Cache: profile name → GPM Profile object.
   * Owned by findProfileByName — it checks here first and populates on miss.
   */
  private readonly profileCache = new Map<string, Profile>();

  /** Slot tracking — each slot maps to a deterministic CDP port. */
  private readonly usedSlots = new Set<number>();
  private slotCounter = 0;

  /**
   * Cached latest Chromium version string fetched from GPMLogin.
   * `null` = not yet fetched. `undefined` = fetch failed (skip version field).
   */
  private latestChromiumVersion: string | null | undefined = null;

  constructor(config: PoolConfig) {
    this.config = config;
    this.concurrency = config.concurrency;
    this.limit = pLimit(this.concurrency);
    this.gpm = new GpmLoginClient(config.gpmBaseUrl);
    log.info('Initialised', {
      concurrency: config.concurrency,
      gpmBaseUrl: config.gpmBaseUrl,
      baseCdpPort: config.baseCdpPort,
    });
  }

  // ── Slot management ───────────────────────────────────────────────────────

  private nextFreeSlot(): number {
    for (let i = 0; i < this.concurrency; i++) {
      const candidate = (this.slotCounter + i) % this.concurrency;
      if (!this.usedSlots.has(candidate)) {
        this.slotCounter = (candidate + 1) % this.concurrency;
        this.usedSlots.add(candidate);
        return candidate;
      }
    }
    // Should never happen — p-limit guarantees at most CONCURRENCY active tasks.
    throw new Error('[GpmProfilePool] no free slot despite limiter allow');
  }

  // ── Profile resolution ────────────────────────────────────────────────────

  private async resolveProfileId(email: string, proxyRaw: string): Promise<string> {
    const profileName = `${PROFILE_PREFIX}${email}`;
    const plog = log.child({ email, profileName });
    plog.debug('resolveProfileId | start');

    const found = await this.findProfileByName(profileName);
    if (found) {
      plog.debug('resolveProfileId | profile found', { profileId: found.id });
      return found.id;
    }

    plog.info('resolveProfileId | no profile — creating', {
      proxyHost: proxyRaw ? `${proxyRaw.split(':')[0]}:***` : 'none',
    });

    const browserVersion = await this.getLatestChromiumVersion();
    plog.debug('resolveProfileId | using browser_version', {
      browserVersion: browserVersion ?? 'default (GPMLogin)',
    });

    const created = await this.gpm.profiles.create({
      name: profileName,
      raw_proxy: proxyRaw,
      ...(browserVersion ? { browser_version: browserVersion } : {}),
    });

    if (!created.success || !created.data) {
      plog.error('resolveProfileId | create FAILED', { message: created.message });
      throw new Error(
        `[GpmProfilePool] Failed to create GPM profile for ${email}: ${created.message}`,
      );
    }

    plog.info('resolveProfileId | profile created', { profileId: created.data.id });
    this.profileCache.set(profileName, created.data);
    return created.data.id;
  }

  private async getLatestChromiumVersion(): Promise<string | undefined> {
    if (this.latestChromiumVersion !== null) return this.latestChromiumVersion ?? undefined;

    log.debug('getLatestChromiumVersion | fetching from GPMLogin');
    try {
      const res = await this.gpm.browsers.versions();
      if (res.success && res.data?.chromium?.length) {
        this.latestChromiumVersion = res.data.chromium[0];
        log.info('getLatestChromiumVersion | fetched', {
          latest: this.latestChromiumVersion,
          available: res.data.chromium.length,
        });
      } else {
        log.warn('getLatestChromiumVersion | empty response — using GPMLogin default');
        this.latestChromiumVersion = undefined;
      }
    } catch (err) {
      log.warn('getLatestChromiumVersion | FAILED — using GPMLogin default', {
        err: String(err),
      });
      this.latestChromiumVersion = undefined;
    }

    return this.latestChromiumVersion ?? undefined;
  }

  private async findProfileByName(name: string): Promise<Profile | null> {
    const cached = this.profileCache.get(name);
    if (cached) {
      log.debug('findProfileByName | CACHE HIT', { name, profileId: cached.id });
      return cached;
    }

    log.debug('findProfileByName | cache miss — searching API', { name });
    let page = 1;

    for (;;) {
      log.debug('findProfileByName | fetching page', { name, page, pageSize: 50 });
      const res = await this.gpm.profiles.list({ page, page_size: 50, search: name });

      if (!res.success || !res.data) {
        log.warn('findProfileByName | API error — aborting search', { name });
        break;
      }

      log.debug('findProfileByName | page result', {
        name, page, lastPage: res.data.last_page,
        total: res.data.total, returned: res.data.data.length,
      });

      const match = res.data.data.find((p) => p.name === name);
      if (match) {
        log.debug('findProfileByName | FOUND', { name, profileId: match.id });
        this.profileCache.set(name, match);
        return match;
      }

      if (page >= res.data.last_page) {
        log.debug('findProfileByName | exhausted all pages — not found', { name });
        break;
      }
      page++;
    }

    return null;
  }

  // ── acquire ───────────────────────────────────────────────────────────────

  acquire(email: string): Promise<BrowserHandle> {
    // Bind email to every log call within this acquire() scope.
    const alog = log.child({ email });
    alog.info('acquire | queued', {
      active: this.limit.activeCount,
      pending: this.limit.pendingCount,
    });

    let resolveDeferred!: () => void;
    const deferred = new Promise<void>((res) => { resolveDeferred = res; });

    let handleResolve!: (h: BrowserHandle) => void;
    let handleReject!: (e: unknown) => void;
    const handlePromise = new Promise<BrowserHandle>((res, rej) => {
      handleResolve = res;
      handleReject = rej;
    });

    this.limit(async () => {
      let profileId = '';
      let slotIndex = -1;
      alog.info('acquire | slot granted', { active: this.limit.activeCount });

      try {
        slotIndex = this.nextFreeSlot();
        const cdpPort   = this.config.baseCdpPort + slotIndex;

        // Each email gets a fixed proxy port derived from a random seed stored
        // permanently per profile. The port is chosen once (at profile creation)
        // and never changed afterwards.
        const proxyPort    = proxyPortForEmail(email, this.config);
        const proxyRaw     = buildGpmProxy(this.config, proxyPort);
        alog.debug('acquire | slot assigned', { slotIndex, cdpPort, proxyPort });

        // Save assigned proxy back to the database
        try {
          const { updateAccountProxy } = await import('./db');
          await updateAccountProxy(email, proxyRaw);
        } catch (dbErr) {
          alog.warn('acquire | failed to save proxy to db', { err: String(dbErr) });
        }

        // resolveProfileId creates the profile with proxyRaw if it doesn't exist.
        // For existing profiles the proxy is left untouched — it was set at creation.
        profileId = await this.resolveProfileId(email, proxyRaw);

        alog.info('acquire | calling GPM start', { profileId, cdpPort });
        const startRes = await this.gpm.profiles.start(profileId, {
          remote_debugging_port: cdpPort,
        });

        if (!startRes.success || !startRes.data) {
          throw new Error(
            `[GpmProfilePool] GPMLogin start failed for profile ${profileId}: ${startRes.message}`,
          );
        }

        alog.info('acquire | GPM start OK', { profileId, cdpPort });

        await waitForCdp(cdpPort, alog);

        alog.info('acquire | browser ready', { profileId, port: cdpPort });

        const release = async (): Promise<void> => {
          alog.info('release | stopping browser', { profileId, port: cdpPort });
          try {
            await this.gpm.profiles.stop(profileId);
            alog.info('release | GPM stop OK', { profileId });
          } catch (err) {
            alog.error('release | GPM stop FAILED', { profileId, err: String(err) });
          }
          this.usedSlots.delete(slotIndex);
          alog.debug('release | slot freed', {
            slot: slotIndex,
            active: this.limit.activeCount - 1,
            pending: this.limit.pendingCount,
          });
          resolveDeferred();
        };

        handleResolve({ port: cdpPort, release });
      } catch (err) {
        alog.error('acquire | ERROR', {
          profileId: profileId || 'n/a',
          slot: slotIndex,
          err: err instanceof Error ? err.message : String(err),
        });
        if (slotIndex >= 0) this.usedSlots.delete(slotIndex);
        handleReject(err);
        resolveDeferred();
      }

      // Keep the p-limit slot occupied until release() is called.
      await deferred;
      alog.debug('acquire | p-limit slot returned', {
        active: this.limit.activeCount,
        pending: this.limit.pendingCount,
      });
    });

    return handlePromise;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildGpmProxy(config: PoolConfig, port: number): string {
  if (!config.proxyHost || !config.proxyUser || !config.proxyPass) return '';
  return `${config.proxyHost}:${port}:${config.proxyUser}:${config.proxyPass}`;
}

/**
 * Returns a fixed proxy port for a given email by hashing the email string
 * into a random-looking but stable offset within the configured port range.
 *
 * Range: [upstreamProxyBase, upstreamProxyBase + upstreamProxyRange)
 *
 * The same email always resolves to the same port, so the GPM profile keeps
 * a permanent proxy assignment and no update() call is ever needed.
 */
function proxyPortForEmail(email: string, config: PoolConfig): number {
  // djb2 hash — simple, deterministic, good distribution.
  let h = 5381;
  for (let i = 0; i < email.length; i++) {
    h = ((h << 5) + h) ^ email.charCodeAt(i);
    h >>>= 0; // keep unsigned 32-bit
  }
  const offset = h % config.upstreamProxyRange;
  return config.upstreamProxyBase + offset;
}

/** Poll the CDP /json/version endpoint until the browser is responding. */
async function waitForCdp(port: number, alog: ILogger, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await sleep(500);
    try {
      const r = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        alog.debug('waitForCdp | ready', { port, after: `${((i + 1) * 500) / 1000}s` });
        return;
      }
    } catch { /* still starting */ }
    if (i > 0 && i % 5 === 0) {
      alog.debug('waitForCdp | still waiting', { port, attempt: i + 1, total: attempts });
    }
  }
  throw new Error(
    `[GpmProfilePool] Browser on port ${port} did not respond within ${(attempts * 500) / 1_000}s`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
