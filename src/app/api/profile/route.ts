import { NextRequest, NextResponse } from 'next/server';
import { rm } from 'fs/promises';
import { existsSync } from 'fs';
import { loadPoolConfig } from '@/lib/browser-pool';
import { profileDirFor } from '@/lib/chrome-profile-pool';

export const runtime = 'nodejs';

/**
 * DELETE /api/profile
 *
 * Body: { email: string }  — delete profile for a single account
 *   or: { all: true }      — wipe the entire profiles directory
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; all?: boolean };
    const config = loadPoolConfig();

    if (body.all) {
      // Wipe the entire base profiles directory
      if (existsSync(config.profileDir)) {
        await rm(config.profileDir, { recursive: true, force: true });
      }
      return NextResponse.json({ success: true, message: `All profiles deleted from ${config.profileDir}` });
    }

    if (body.email) {
      const profileDir = profileDirFor(body.email, config);
      if (existsSync(profileDir)) {
        await rm(profileDir, { recursive: true, force: true });
        return NextResponse.json({ success: true, message: `Profile deleted for ${body.email}` });
      }
      // Profile didn't exist — still a success from the user's perspective
      return NextResponse.json({ success: true, message: `No profile found for ${body.email}` });
    }

    return NextResponse.json({ error: 'Provide either { email } or { all: true }' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
