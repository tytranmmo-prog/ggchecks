import { NextRequest, NextResponse } from 'next/server';
import { getAccountStore } from '@/lib/store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, totpSecret } = body;

    if (!id || !totpSecret) {
      return NextResponse.json({ error: 'id and totpSecret are required' }, { status: 400 });
    }

    await getAccountStore().update2FASecret(id, totpSecret);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
