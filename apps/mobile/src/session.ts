import * as SecureStore from 'expo-secure-store';

/**
 * The phone app's own session, handed over by the web app after sign-in (POST /me/device-session).
 * Kept in the phone's secure storage; used only for the arrival check and push registration.
 */
const KEY = 'manorg.device';

export interface DeviceSession {
  refreshToken: string;
  orgId: string | null;
  origin: string;
  pushToken?: string;
}

export async function loadSession(): Promise<DeviceSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as DeviceSession) : null;
}

export async function saveSession(session: DeviceSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/** A fresh access token; the refresh token rotates and the new one is saved. */
export async function accessToken(session: DeviceSession): Promise<string | null> {
  const res = await fetch(`${session.origin}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  }).catch(() => null);
  if (!res) return null;
  if (res.status === 401) {
    // Signed out elsewhere, or the session ended: stop background work until the next sign-in.
    await clearSession();
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { tokens: { accessToken: string; refreshToken: string } };
  await saveSession({ ...session, refreshToken: body.tokens.refreshToken });
  return body.tokens.accessToken;
}

/** One authenticated API call from the phone app. */
export async function apiCall<T>(
  session: DeviceSession,
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const token = await accessToken(session);
  if (!token) return null;
  const res = await fetch(`${session.origin}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(session.orgId ? { 'X-Organization-Id': session.orgId } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!res?.ok) return null;
  return res.status === 204 ? (null as T) : ((await res.json()) as T);
}
