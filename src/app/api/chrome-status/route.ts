import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const port = parseInt(searchParams.get('port') || '9222', 10);

  try {
    const res = await fetch(`http://localhost:${port}/json/version`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) throw new Error('Not OK');
    const data = await res.json() as { Browser?: string; 'Protocol-Version'?: string };
    return Response.json({ running: true, browser: data.Browser || 'Chrome', port });
  } catch {
    return Response.json({ running: false, port });
  }
}
