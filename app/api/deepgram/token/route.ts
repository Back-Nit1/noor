import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mint a SHORT-LIVED Deepgram token for the browser. Never ship DEEPGRAM_API_KEY to the client —
// the browser passes this token as a websocket subprotocol (['bearer', token]).
//
// NOTE: /v1/auth/grant requires an API key with **Member or higher** role. A key scoped lower
// gets FORBIDDEN / "Insufficient permissions", so we translate that into an actionable message
// instead of a silent failure on stage.

const TTL_SECONDS = 300;

// Reuse a token until it's nearly expired — a page reload mid-demo shouldn't re-hit the API.
let cached: { token: string; expiresAt: number } | null = null;

export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'DEEPGRAM_API_KEY is not set. Add it to .env.local and restart `pnpm dev`.' },
      { status: 500 },
    );
  }

  if (cached && Date.now() < cached.expiresAt) {
    return NextResponse.json({ access_token: cached.token, cached: true });
  }

  let res: Response;
  try {
    res = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
    });
  } catch (e) {
    return NextResponse.json({ error: `Could not reach Deepgram: ${(e as Error).message}` }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text();
    const hint =
      res.status === 401 || res.status === 403
        ? 'This Deepgram API key cannot mint short-lived tokens. Create a key with the "Member" ' +
          'role (or higher) at console.deepgram.com → Settings → API Keys, then set DEEPGRAM_API_KEY.'
        : 'Deepgram rejected the token request.';
    return NextResponse.json({ error: hint, status: res.status, detail }, { status: res.status });
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    return NextResponse.json({ error: 'Deepgram returned no access_token.' }, { status: 502 });
  }

  const ttl = data.expires_in ?? TTL_SECONDS;
  cached = { token: data.access_token, expiresAt: Date.now() + Math.max(ttl - 15, 5) * 1000 };

  return NextResponse.json({ access_token: data.access_token, expires_in: ttl });
}
