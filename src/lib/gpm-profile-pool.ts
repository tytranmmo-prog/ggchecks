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
 * Key differences from CachedProfilePool:
 *   - No Chrome spawn / kill — GPMLogin owns the process.
 *   - No run-proxy.js sidecar — proxy is stored in the GPM profile itself.
 *   - CDP port comes from the GPMLogin API response, not a manual port counter.
 *
 * Proxy format for GPMLogin: IP:PORT:Username:Password
 *   e.g. "isp.oxylabs.io:8001:user123:pass456"
 *
 * Concurrency: same p-limit deferred-promise pattern as CachedProfilePool.
 *
 * Config env vars:
 *   GPM_BASE_URL         — GPMLogin local server URL (default http://127.0.0.1:19995)
 *
 * Implements: BrowserPool (browser-pool.ts)
 */

import pLimit from 'p-limit';
import type { BrowserHandle, BrowserPool, PoolConfig, PoolType } from './browser-pool';
import { GpmLoginClient } from './gpm-login';
import type { Profile } from './gpm-login';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Profile name prefix so GPM-managed profiles are recognisable in the UI. */
const PROFILE_PREFIX = 'ggchecks::';

/** Tagged logger — always on, easy to grep in server output. */
const log = (...args: unknown[]) =>
  console.log(`[GpmProfilePool ${new Date().toISOString()}]`, ...args);

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
   * Keyed by the full profile name (with PROFILE_PREFIX), not the raw email.
   */
  private readonly profileCache = new Map<string, Profile>();

  /**
   * Slot tracking — mirrors CachedProfilePool.
   * Each slot maps to a deterministic CDP port: baseCdpPort + slotIndex.
   * Guaranteed to stay within CONCURRENCY because p-limit gates entry.
   */
  private readonly usedSlots = new Set<number>();
  private slotCounter = 0;

  /**
   * Cached latest Chromium version string fetched from GPMLogin.
   * Populated on first profile creation; reused for all subsequent ones.
   * `null` = not yet fetched. `undefined` = fetch failed (skip version field).
   */
  private latestChromiumVersion: string | null | undefined = null;

  constructor(config: PoolConfig) {
    this.config = config;
    this.concurrency = config.concurrency;
    this.limit = pLimit(this.concurrency);
    const gpmBaseUrl = config.gpmBaseUrl;
    this.gpm = new GpmLoginClient(gpmBaseUrl);
    log(`Initialised | concurrency=${config.concurrency} gpmBaseUrl=${gpmBaseUrl} baseCdpPort=${config.baseCdpPort}`);
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

  /**
   * Find or create the GPM profile for this email.
   *
   * GPMLogin does NOT auto-create profiles on `start` — we must ensure the
   * profile exists before calling the start endpoint.
   *
   * Returns the GPM profile ID (a UUID string).
   */
  private async resolveProfileId(email: string, proxyRaw: string): Promise<string> {
    const profileName = `${PROFILE_PREFIX}${email}`;
    log(`resolveProfileId | email=${email} profileName=${profileName}`);

    // findProfileByName handles its own cache — no duplicate cache logic here.
    const found = await this.findProfileByName(profileName);
    if (found) {
      log(`resolveProfileId | profile found id=${found.id}`);
      return found.id;
    }

    // No profile found → create one with the proxy pre-attached.
    log(`resolveProfileId | no profile found, creating... proxy=${proxyRaw ? proxyRaw.split(':')[0] + ':***' : 'none'}`);

    const browserVersion = await this.getLatestChromiumVersion();
    log(`resolveProfileId | using browser_version=${browserVersion ?? 'default'}`);

    const created = await this.gpm.profiles.create({
      name: profileName,
      raw_proxy: proxyRaw,
      ...(browserVersion ? { browser_version: browserVersion } : {}),
    });

    if (!created.success || !created.data) {
      log(`resolveProfileId | create FAILED message=${created.message}`);
      throw new Error(
        `[GpmProfilePool] Failed to create GPM profile for ${email}: ${created.message}`,
      );
    }

    log(`resolveProfileId | profile created id=${created.data.id}`);
    // Populate cache so subsequent acquire() calls skip the API search.
    this.profileCache.set(profileName, created.data);
    return created.data.id;
  }

  /**
   * Fetch and cache the latest Chromium version from GPMLogin.
   *
   * Called once on first profile creation. Subsequent calls return the
   * cached value immediately without hitting the API.
   *
   * Returns `undefined` if the API call fails (profile is created without
   * an explicit version, letting GPMLogin pick its default).
   */
  private async getLatestChromiumVersion(): Promise<string | undefined> {
    // Already fetched (string) or already failed (undefined) — return cached.
    if (this.latestChromiumVersion !== null) return this.latestChromiumVersion ?? undefined;

    log('getLatestChromiumVersion | fetching available versions from GPMLogin');
    try {
      const res = await this.gpm.browsers.versions();
      if (res.success && res.data?.chromium?.length) {
        this.latestChromiumVersion = res.data.chromium[0];
        log(`getLatestChromiumVersion | latest=${this.latestChromiumVersion} (${res.data.chromium.length} versions available)`);
      } else {
        log('getLatestChromiumVersion | empty response, will use GPMLogin default');
        this.latestChromiumVersion = undefined;
      }
    } catch (err) {
      log('getLatestChromiumVersion | fetch FAILED, will use GPMLogin default', err);
      this.latestChromiumVersion = undefined;
    }

    return this.latestChromiumVersion ?? undefined;
  }

  /**
   * Look up a GPM profile by exact name.
   *
   * Checks the in-process cache first — if a previous call already found or
   * created this profile, the API is never called again. On a cache miss,
   * pages through the GPMLogin profile list until a match is found (or all
   * pages are exhausted), then stores the result in cache before returning.
   *
   * Returns the matching Profile, or `null` if it does not exist in GPMLogin.
   */
  private async findProfileByName(name: string): Promise<Profile | null> {
    // ── Cache hit ──────────────────────────────────────────────────────────
    const cached = this.profileCache.get(name);
    if (cached) {
      log(`findProfileByName | CACHE HIT name=${name} id=${cached.id}`);
      return cached;
    }

    // ── API search (paginated) ─────────────────────────────────────────────
    log(`findProfileByName | cache miss, searching API name=${name}`);
    let page = 1;

    for (;;) {
      log(`findProfileByName | fetching page=${page} page_size=50`);
      const res = await this.gpm.profiles.list({ page, page_size: 50, search: name });

      if (!res.success || !res.data) {
        log(`findProfileByName | API error or empty response, aborting search`);
        break;
      }

      log(`findProfileByName | page=${page}/${res.data.last_page} total=${res.data.total} returned=${res.data.data.length}`);

      const match = res.data.data.find((p) => p.name === name);
      if (match) {
        log(`findProfileByName | FOUND id=${match.id} name=${match.name}`);
        // Populate cache before returning so the next call is instant.
        this.profileCache.set(name, match);
        return match;
      }

      // Stop when we've retrieved the last page.
      if (page >= res.data.last_page) {
        log(`findProfileByName | exhausted all pages, profile not found`);
        break;
      }
      page++;
    }

    return null;
  }

  // ── acquire ───────────────────────────────────────────────────────────────

  acquire(email: string): Promise<BrowserHandle> {
    log(`acquire | queued email=${email} active=${this.limit.activeCount} pending=${this.limit.pendingCount}`);

    // Deferred-promise pattern (identical to CachedProfilePool):
    // The p-limit task wraps a deferred that only resolves when release() is
    // called, so the concurrency slot stays occupied for the full browser session.
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
      log(`acquire | slot granted email=${email} active=${this.limit.activeCount}`);

      try {
        // Assign a deterministic slot → CDP port before calling GPMLogin.
        slotIndex = this.nextFreeSlot();
        const cdpPort       = this.config.baseCdpPort + slotIndex;
        const proxyPort     = this.config.upstreamProxyBase + (slotIndex % this.config.upstreamProxyRange);
        const slotProxyRaw  = buildGpmProxy(this.config, proxyPort);
        log(`acquire | slotIndex=${slotIndex} cdpPort=${cdpPort} proxyPort=${proxyPort}`);

        // Build the creation-time proxy (base port — slot not yet known at creation).
        const createProxyRaw = buildGpmProxy(this.config, this.config.upstreamProxyBase);

        // 1. Ensure GPM profile exists (create if necessary).
        profileId = await this.resolveProfileId(email, createProxyRaw);

        // 2. Update the profile's proxy to the slot-specific port so no two
        //    concurrent sessions in the same batch share the same upstream proxy.
        if (slotProxyRaw) {
          log(`acquire | updating proxy to port=${proxyPort} for profileId=${profileId}`);
          const updateRes = await this.gpm.profiles.update(profileId, { raw_proxy: slotProxyRaw });
          if (!updateRes.success) {
            log(`acquire | proxy update FAILED (non-fatal): ${updateRes.message}`);
          }
        }

        // 3. Ask GPMLogin to open the browser on the pre-assigned port.
        log(`acquire | calling GPM start profileId=${profileId} cdpPort=${cdpPort}`);
        const startRes = await this.gpm.profiles.start(profileId, {
          remote_debugging_port: cdpPort,
        });

        if (!startRes.success || !startRes.data) {
          throw new Error(
            `[GpmProfilePool] GPMLogin start failed for profile ${profileId}: ${startRes.message}`,
          );
        }

        log(`acquire | GPM start OK profileId=${profileId} cdpPort=${cdpPort}`);

        // 3. Wait until the CDP endpoint is reachable.
        await waitForCdp(cdpPort);

        log(`acquire | browser ready email=${email} profileId=${profileId} port=${cdpPort}`);

        // 4. Expose handle; release() stops the browser via GPMLogin.
        const release = async (): Promise<void> => {
          log(`release | stopping browser email=${email} profileId=${profileId} port=${cdpPort}`);
          try {
            await this.gpm.profiles.stop(profileId);
            log(`release | GPM stop OK profileId=${profileId}`);
          } catch (err) {
            log(`release | GPM stop FAILED profileId=${profileId}`, err);
          }
          this.usedSlots.delete(slotIndex);
          log(`release | done email=${email} slot=${slotIndex} active=${this.limit.activeCount - 1} pending=${this.limit.pendingCount}`);
          resolveDeferred();
        };

        handleResolve({ port: cdpPort, release });
      } catch (err) {
        log(`acquire | ERROR email=${email} profileId=${profileId || 'n/a'} slot=${slotIndex}`, err);
        if (slotIndex >= 0) this.usedSlots.delete(slotIndex);
        handleReject(err);
        resolveDeferred();
      }

      // Keep the p-limit slot occupied until release() is called.
      await deferred;
      log(`acquire | slot released email=${email} active=${this.limit.activeCount} pending=${this.limit.pendingCount}`);
    });

    return handlePromise;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a proxy connection string in GPMLogin format: IP:PORT:Username:Password
 *
 * @param config  Pool config supplying host/user/pass.
 * @param port    Upstream proxy port for this specific slot.
 *                Pass `upstreamProxyBase` at profile-creation time (slot unknown);
 *                pass the computed slot port just before `start()`.
 */
function buildGpmProxy(config: PoolConfig, port: number): string {
  if (!config.proxyHost || !config.proxyUser || !config.proxyPass) {
    return ''; // No proxy configured.
  }
  return `${config.proxyHost}:${port}:${config.proxyUser}:${config.proxyPass}`;
}

/** Poll the CDP /json/version endpoint until the browser is responding. */
async function waitForCdp(port: number, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await sleep(500);
    try {
      const r = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        log(`waitForCdp | port=${port} ready after ${((i + 1) * 500) / 1000}s`);
        return;
      }
    } catch { /* still starting */ }
    if (i > 0 && i % 5 === 0) {
      log(`waitForCdp | port=${port} still waiting... attempt=${i + 1}/${attempts}`);
    }
  }
  throw new Error(
    `[GpmProfilePool] Browser on port ${port} did not respond within ${(attempts * 500) / 1_000}s`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
