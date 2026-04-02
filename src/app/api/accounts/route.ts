import { NextRequest, NextResponse } from 'next/server';
import { getAccounts, addAccount } from '@/lib/db';

export async function GET() {
  try {
    const accounts = await getAccounts();
    return NextResponse.json({ accounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, totpSecret } = body;
    if (!email || !password || !totpSecret) {
      return NextResponse.json({ error: 'email, password, totpSecret are required' }, { status: 400 });
    }
    await addAccount({ email, password, totpSecret });
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
