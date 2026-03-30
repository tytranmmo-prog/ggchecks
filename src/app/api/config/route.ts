import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getConfig, ALLOWED_KEYS } from '@/lib/config';
import { createLogger } from '@/lib/pino-logger';

const log = createLogger('config');

export async function GET() {
  try {
    const finalConfig: Record<string, string> = {};
    for (const key of ALLOWED_KEYS) {
      finalConfig[key] = getConfig(key);
    }

    return NextResponse.json({ config: finalConfig });
  } catch (error: unknown) {
    log.error('GET config failed', { err: String(error) });
    return NextResponse.json({ error: 'Failed to retrieve configuration' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { updates } = await request.json();
    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Invalid updates payload' }, { status: 400 });
    }

    const configPath = path.join(process.cwd(), 'runtime-config.json');
    let currentConfig: Record<string, string> = {};
    
    try {
      if (fsSync.existsSync(configPath)) {
        const content = await fs.readFile(configPath, 'utf8');
        currentConfig = JSON.parse(content);
      }
    } catch {
      // Missing or invalid JSON is fine, we just start fresh
      currentConfig = {};
    }

    for (const key of ALLOWED_KEYS) {
      if (key in updates) {
        currentConfig[key] = updates[key];
      }
    }

    await fs.writeFile(configPath, JSON.stringify(currentConfig, null, 2), 'utf8');

    return NextResponse.json({ success: true, message: 'Configuration updated successfully' });
  } catch (error: unknown) {
    log.error('POST config save failed', { err: String(error) });
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 });
  }
}
