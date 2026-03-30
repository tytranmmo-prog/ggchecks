import fs from 'fs';
import path from 'path';

/**
 * Reads a configuration value.
 * Uses `runtime-config.json` in the project root if it exists,
 * otherwise falls back to `process.env`.
 */
export function getConfig(key: string): string {
  try {
    const configPath = path.join(process.cwd(), 'runtime-config.json');
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data[key] !== undefined && data[key] !== '') {
        return String(data[key]);
      }
    }
  } catch (e) {
    // Ignore error, fallback to process.env
  }
  return process.env[key] || '';
}

/**
 * Helper to get a configuration value as a number.
 */
export function getConfigNumber(key: string, defaultValue = 0): number {
  const val = getConfig(key);
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultValue : num;
}

export const ALLOWED_KEYS = [
  // General
  'BULK_CONCURRENCY',

  // Proxy (Oxylabs)
  'OXYLABS_PROXY_HOST',
  'OXYLABS_PROXY_USER',
  'OXYLABS_PROXY_PASS',
  'OXYLABS_BASE_PORT',
  'OXYLABS_PORT_RANGE',

  // Google Sheets / Drive
  'GOOGLE_SHEET_ID',
  'DRIVE_SCREENSHOT_FOLDER_ID',
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_DELEGATED_SUBJECT',
  // NOTE: GOOGLE_PRIVATE_KEY is intentionally absent — its multi-line PEM
  //       format is fragile in JSON. Keep it in .env.local only.

  // Browser / GPMLogin
  'CHROME_PATH',
  'GPM_BASE_URL',
  'BULK_BASE_PORT',
  'BULK_BASE_PROXY_PORT',
  'BULK_PROFILE_DIR',

  // Scripts
  'CHECKER_PATH',
  'CHANGE2FA_PATH',
];

/**
 * Returns an object with all allowed configuration keys resolved.
 */
export function getAllConfigs(): Record<string, string> {
  const config: Record<string, string> = {};
  for (const key of ALLOWED_KEYS) {
    config[key] = getConfig(key);
  }
  return config;
}
