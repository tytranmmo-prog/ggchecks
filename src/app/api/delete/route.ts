import { NextRequest, NextResponse } from 'next/server';
import { deleteAccount } from '@/lib/db';

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await deleteAccount(id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

