import { type Schemas } from '@manorg/contracts';

export type { Schemas };

// Same origin by default: the web server forwards /api/v1 to the API (next.config.ts), so no
// CORS is needed and a preview link works. NEXT_PUBLIC_API_URL points the browser elsewhere.
const BASE = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1`;
const TOKENS = 'manorg.tokens';
const ORG = 'manorg.org';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

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
  tokens: () => read<Tokens>(TOKENS),
  setTokens: (t: Tokens | null) => write(TOKENS, t),
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

async function refresh(): Promise<boolean> {
  const t = session.tokens();
  if (!t) return false;
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: t.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) {
        session.setTokens(null);
        return false;
      }
      const body = (await res.json()) as { tokens: Tokens };
      session.setTokens(body.tokens);
      return true;
    })
    .finally(() => {
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
  const t = session.tokens();
  if (t) headers.Authorization = `Bearer ${t.accessToken}`;
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
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatTime(iso: string | null | undefined, timeZone = 'Asia/Seoul'): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}
