import { NextRequest, NextResponse } from 'next/server';
import { update2FASecret } from '@/lib/sheets';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { rowIndex, totpSecret } = body;

    if (!rowIndex || !totpSecret) {
      return NextResponse.json({ error: 'rowIndex and totpSecret are required' }, { status: 400 });
    }

    await update2FASecret(rowIndex, totpSecret);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
