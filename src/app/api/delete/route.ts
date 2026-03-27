import { NextRequest, NextResponse } from 'next/server';
import { deleteAccount } from '@/lib/sheets';

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { rowIndex } = body;
    if (!rowIndex) return NextResponse.json({ error: 'rowIndex required' }, { status: 400 });
    await deleteAccount(rowIndex);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
