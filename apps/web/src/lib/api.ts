import { getLocale, INTL, t } from './i18n';
import { type Schemas } from '@manorg/contracts';

export type { Schemas };

// Same origin by default: the web server forwards /api/v1 to the API (next.config.ts), so no
// CORS is needed and a preview link works. NEXT_PUBLIC_API_URL points the browser elsewhere.
const BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1`;
const ORG = 'manorg.org';
/** Header the web server's /session routes require: a cross-site form cannot send it. */
export const SESSION_HEADER = { 'X-Manorg-Session': '1' };

/**
 * The access token lives in memory only. The refresh token is an httpOnly cookie that only the
 * web server's /session routes read (app/session/[action]/route.ts), so page scripts never see it.
 */
let accessToken: string | null = null;

/** The API's error body: { error: { code, message, fields } }. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }
}

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private mode); the session then lasts for this page only.
  }
}

export const session = {
  access: () => accessToken,
  setAccess: (t: string | null) => {
    accessToken = t;
  },
  org: () => read<string>(ORG),
  setOrg: (id: string | null) => write(ORG, id),
};

export interface CallOptions {
  body?: unknown;
  form?: FormData;
  /** Organization to act in; defaults to the one chosen in this browser. Null: none. */
  org?: string | null;
  ifMatch?: number;
  idempotencyKey?: string;
}

let refreshing: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  const res = await fetch('/session/refresh', {
    method: 'POST',
    headers: SESSION_HEADER,
    credentials: 'same-origin',
  }).catch(() => null);
  if (!res?.ok) {
    accessToken = null;
    return false;
  }
  accessToken = ((await res.json()) as { accessToken: string | null }).accessToken;
  return accessToken !== null;
}

/**
 * Gets a new access token from the cookie. Tabs take turns (Web Locks), because a refresh token
 * used twice ends the whole session on the server.
 */
export function refresh(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  refreshing ??= (
    navigator.locks ? navigator.locks.request('manorg-refresh', () => refreshOnce()) : refreshOnce()
  ).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/** Calls the REST API under /api/v1. Throws ApiError with the API's code, message and fields. */
export async function api<T>(
  method: string,
  path: string,
  opts: CallOptions = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const org = opts.org === undefined ? session.org() : opts.org;
  if (org) headers['X-Organization-Id'] = org;
  if (opts.ifMatch !== undefined) headers['If-Match'] = `"${opts.ifMatch}"`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'No connection to the server. Check the internet and try again.',
    );
  }
  if (res.status === 401 && !retried && !path.startsWith('/auth/') && (await refresh())) {
    return api<T>(method, path, opts, true);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as {
    error?: { code: string; message: string; fields?: Record<string, string[]> };
  } | null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'ERROR',
      e?.message ?? 'Something went wrong. Try again.',
      e?.fields ?? {},
    );
  }
  return data as T;
}

export const get = <T>(path: string, opts?: CallOptions) => api<T>('GET', path, opts);
export const post = <T>(path: string, body?: unknown, opts?: CallOptions) =>
  api<T>('POST', path, { ...opts, body });
export const put = <T>(path: string, body?: unknown, opts?: CallOptions) =>
  api<T>('PUT', path, { ...opts, body });
export const patch = <T>(path: string, body?: unknown, opts?: CallOptions) =>
  api<T>('PATCH', path, { ...opts, body });
export const del = <T>(path: string, opts?: CallOptions) => api<T>('DELETE', path, opts);

/** Local calendar date of now in a time zone, YYYY-MM-DD. */
export function today(timeZone = 'Asia/Seoul', offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? t('{h} h {m} min', { h, m }) : t('{m} min', { m });
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(INTL[getLocale()], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatTime(iso: string | null | undefined, timeZone = 'Asia/Seoul'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(INTL[getLocale()], {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** Sign-in, registration and sign-out go through the web server, which keeps the cookie. */
export async function sessionCall(
  action: 'login' | 'register' | 'logout',
  body?: unknown,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/session/${action}`, {
      method: 'POST',
      headers: { ...SESSION_HEADER, 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'No connection to the server. Check the internet and try again.',
    );
  }
  if (action === 'logout') {
    accessToken = null;
    return;
  }
  const data = (await res.json().catch(() => null)) as {
    accessToken?: string;
    error?: { code: string; message: string; fields?: Record<string, string[]> };
  } | null;
  if (!res.ok || !data?.accessToken) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'ERROR',
      e?.message ?? 'Something went wrong. Try again.',
      e?.fields ?? {},
    );
  }
  accessToken = data.accessToken;
}
