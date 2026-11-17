import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/**
 * Sign-in for the web app. The API's refresh token is kept in an httpOnly cookie that page scripts
 * cannot read; the browser only ever holds a short-lived access token in memory.
 */
const API = `${process.env.API_ORIGIN ?? 'http://localhost:3001'}/api/v1`;
const COOKIE = 'manorg_rt';
const ACTIONS = new Set(['login', 'register', 'refresh', 'logout']);

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/session',
    maxAge,
  };
}

async function callApi(path: string, body: unknown, req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  return fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(forwarded ? { 'X-Forwarded-For': forwarded } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  if (!ACTIONS.has(action))
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Not found.' } },
      { status: 404 },
    );
  // A custom header cannot be sent by another site's form or image; with SameSite=Strict this
  // blocks cross-site requests to these routes.
  if (req.headers.get('x-manorg-session') !== '1') {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Not allowed.' } },
      { status: 403 },
    );
  }
  const jar = await cookies();
  const current = jar.get(COOKIE)?.value;

  if (action === 'logout') {
    if (current) await callApi('/auth/logout', { refreshToken: current }, req).catch(() => null);
    const res = new NextResponse(null, { status: 204 });
    res.cookies.set(COOKIE, '', cookieOptions(0));
    return res;
  }

  let upstream: Response;
  if (action === 'refresh') {
    // No cookie: simply not signed in; nothing to report as an error.
    if (!current)
      return NextResponse.json({ accessToken: null }, { headers: { 'Cache-Control': 'no-store' } });
    upstream = await callApi('/auth/refresh', { refreshToken: current }, req);
  } else {
    const body = (await req.json().catch(() => null)) as unknown;
    upstream = await callApi(`/auth/${action}`, body ?? {}, req);
  }
  const data = (await upstream.json().catch(() => null)) as { tokens?: Tokens } | null;
  if (!upstream.ok || !data?.tokens) {
    const res = NextResponse.json(
      data ?? { error: { code: 'ERROR', message: 'Something went wrong. Try again.' } },
      { status: upstream.status || 502 },
    );
    if (action === 'refresh' && upstream.status === 401)
      res.cookies.set(COOKIE, '', cookieOptions(0));
    return res;
  }
  const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
  const res = NextResponse.json(
    { accessToken: data.tokens.accessToken },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  res.cookies.set(COOKIE, data.tokens.refreshToken, cookieOptions(days * 86_400));
  return res;
}
