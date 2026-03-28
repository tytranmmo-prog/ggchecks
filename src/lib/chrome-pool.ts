/**
 * chrome-pool.ts  —  PersistentChromePool
 *
 * Implements BrowserPool using long-lived Chrome instances.
 * Each of the N slots has its own permanent profile directory and stays
 * running between checks. Fast second-check startup, but profile state
 * accumulates over time.
 *
 * Implements: BrowserPool (browser-pool.ts)
 */

import { spawn }        from 'child_process';
import { join }         from 'path';
import type { BrowserHandle, BrowserPool, PoolType } from './browser-pool';

import { getConfig, getConfigNumber } from './config';
import type { PoolConfig } from './browser-pool';

// ─── Helpers (still exported for direct use / tests) ────────────────────────

export function getChromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin')
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32')
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return '/usr/bin/google-chrome';
}

/** Start Chrome on a specific port (no-op if already running). */
export async function ensureChrome(port: number, config: PoolConfig): Promise<void> {
  try {
    const r = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) return;
  } catch { /* not up yet */ }

  const profileDir = `${config.profileDir}/slot-${port}`;
  const portIndex  = port - config.baseCdpPort;

  const proxyPort      = config.upstreamProxyBase + (portIndex % config.upstreamProxyRange);
  const localProxyPort = 10000 + proxyPort;

  const proxyHelper = join(process.cwd(), 'src', 'lib', 'run-proxy.js');
  const proxyChild = spawn('node', [proxyHelper, localProxyPort.toString(), proxyPort.toString()], {
    detached: true,
    stdio:    'ignore',
    env: {
      ...process.env,
      OXYLABS_PROXY_HOST: config.proxyHost,
      OXYLABS_PROXY_USER: config.proxyUser,
      OXYLABS_PROXY_PASS: config.proxyPass,
    },
  });
  proxyChild.unref();

  await new Promise(r => setTimeout(r, 1000));

  const child = spawn(getChromePath(), [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--proxy-server=http://127.0.0.1:${localProxyPort}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--no-first-run',
    '--no-default-browser-check',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise<void>(r => setTimeout(r, 500));
    try {
      const r = await fetch(`http://localhost:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) return;
    } catch { /* still starting */ }
  }
  throw new Error(`Chrome on port ${port} did not start within 15 s`);
}

// ─── BrowserPool implementation ───────────────────────────────────────────────

export class PersistentChromePool implements BrowserPool {
  readonly type: PoolType = 'persistent';
  readonly concurrency: number;
  private readonly config: PoolConfig;

  // Slot availability map: port → free?
  private readonly slots: Record<number, boolean> = {};

  constructor(config: PoolConfig) {
    this.config = config;
    this.concurrency = config.concurrency;

    for (let i = 0; i < this.concurrency; i++) {
      this.slots[this.config.baseCdpPort + i] = true;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  acquire(_email: string): Promise<BrowserHandle> {
    return new Promise(resolve => {
      const poll = async () => {
        const port = Object.keys(this.slots)
          .map(Number)
          .find(p => this.slots[p]);

        if (port !== undefined) {
          this.slots[port] = false;
          await ensureChrome(port, this.config);
          resolve({
            port,
            release: async () => { this.slots[port] = true; },
          });
        } else {
          setTimeout(poll, 200);
        }
      };
      poll();
    });
  }
}
