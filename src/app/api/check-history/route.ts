import { NextRequest } from 'next/server';
import { getCheckHistory } from '@/lib/db';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 20;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = Number(searchParams.get('accountId'));
  const cursor    = Number(searchParams.get('cursor') || 0);
  const limit     = Math.min(Number(searchParams.get('limit') || DEFAULT_LIMIT), 100);

  if (!accountId || isNaN(accountId)) {
    return Response.json({ error: 'accountId is required' }, { status: 400 });
  }

  const result = await getCheckHistory({ serviceAccountId: accountId, cursor, limit });
  return Response.json(result);
}
