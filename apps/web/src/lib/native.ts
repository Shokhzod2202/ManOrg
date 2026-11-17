import { post } from './api';

/** Messages from the web app to the Haydar phone app (apps/mobile), when it hosts this page. */
export type NativeMessage =
  | { type: 'session'; refreshToken: string; orgId: string | null; origin: string }
  | { type: 'org'; orgId: string | null }
  | { type: 'signed-out' };

interface Bridge {
  postMessage: (data: string) => void;
}

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { ReactNativeWebView?: Bridge }).ReactNativeWebView ?? null;
}

export const insidePhoneApp = () => bridge() !== null;

function send(message: NativeMessage): void {
  bridge()?.postMessage(JSON.stringify(message));
}

/**
 * Inside the phone app, gives it its own session once per sign-in, so it can check arrivals and
 * register for push while the app is closed. Nothing happens in a normal browser.
 */
export async function linkPhoneApp(userId: string, orgId: string | null): Promise<void> {
  if (!bridge()) return;
  const key = 'manorg.phone.linked';
  try {
    if (window.sessionStorage.getItem(key) === userId) {
      send({ type: 'org', orgId });
      return;
    }
  } catch {
    // No storage: link again; the server issues a new session each time.
  }
  const res = await post<{ refreshToken: string }>('/me/device-session', undefined, {
    org: null,
  }).catch(() => null);
  if (!res) return;
  send({ type: 'session', refreshToken: res.refreshToken, orgId, origin: window.location.origin });
  try {
    window.sessionStorage.setItem(key, userId);
  } catch {
    // Not remembered; harmless.
  }
}

export function phoneAppOrg(orgId: string | null): void {
  send({ type: 'org', orgId });
}

export function phoneAppSignedOut(): void {
  try {
    window.sessionStorage.removeItem('manorg.phone.linked');
  } catch {
    // Nothing stored.
  }
  send({ type: 'signed-out' });
}
