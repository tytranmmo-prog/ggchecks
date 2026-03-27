import { spawn } from 'child_process';
import { join } from 'path';

export const CONCURRENCY = parseInt(process.env.BULK_CONCURRENCY || '10', 10);
export const BASE_PORT   = parseInt(process.env.BULK_BASE_PORT   || '9300', 10);
export const PROFILE_DIR = process.env.BULK_PROFILE_DIR || '/tmp/ggchecks-profiles';

// One Chrome per slot, each with its own persistent profile
const slotAvailable: Record<number, boolean> = {};
for (let i = 0; i < CONCURRENCY; i++) {
  slotAvailable[BASE_PORT + i] = true;
}

export function getChromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.platform === 'darwin')
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'win32')
    return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  return '/usr/bin/google-chrome';
}

/** Start Chrome on a specific port (no-op if already running). */
export async function ensureChrome(port: number): Promise<void> {
  try {
    const r = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) return;
  } catch { /* not up yet */ }

  const profileDir = `${PROFILE_DIR}/slot-${port}`;
  // The first slot has port === BASE_PORT, so portIndex is 0
  const portIndex = port - BASE_PORT;
  
  // Choose an upstream proxy port (8001 - 8099)
  const proxyPort = 8001 + (portIndex % 99);
  // Spawn a local unauthenticated proxy (on 10000 + proxyPort) to forward traffic via proxy-chain
  const localProxyPort = 10000 + proxyPort;

  // Make sure to spawn the helper completely detached so it survives
  const proxyHelper = join(process.cwd(), 'src', 'lib', 'run-proxy.js');
  const proxyChild = spawn('node', [proxyHelper, localProxyPort.toString(), proxyPort.toString()], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      OXYLABS_PROXY_HOST: process.env.OXYLABS_PROXY_HOST ?? 'isp.oxylabs.io',
      OXYLABS_PROXY_USER: process.env.OXYLABS_PROXY_USER ?? '',
      OXYLABS_PROXY_PASS: process.env.OXYLABS_PROXY_PASS ?? '',
    },
  });
  proxyChild.unref();

  // Give local proxy-chain a second to bind
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

/** Claim a free slot. Resolves when a slot is available. */
export async function waitForSlot(): Promise<{ port: number; release: () => void }> {
  return new Promise(resolve => {
    const poll = () => {
      const port = (Object.keys(slotAvailable) as unknown as number[])
        .map(Number)
        .find(p => slotAvailable[p]);
      if (port !== undefined) {
        slotAvailable[port] = false;
        resolve({ port, release: () => { slotAvailable[port] = true; } });
      } else {
        setTimeout(poll, 200);
      }
    };
    poll();
  });
}
