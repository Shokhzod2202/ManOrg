/**
 * Pure helpers for the bridge between the website and the phone app, kept apart so they can be
 * tested without a phone.
 */
export type BridgeMessage =
  | { type: 'session'; refreshToken: string; orgId: string | null; origin: string }
  | { type: 'org'; orgId: string | null }
  | { type: 'signed-out' };

/** Same scheme, host and port: a page from anywhere else cannot hand the app a session. */
export function sameSite(pageUrl: string, webUrl: string): boolean {
  try {
    return new URL(pageUrl).origin === new URL(webUrl).origin;
  } catch {
    return false;
  }
}

/** Reads a message from the page; anything malformed or from another site is ignored. */
export function parseMessage(data: string, pageUrl: string, webUrl: string): BridgeMessage | null {
  if (!sameSite(pageUrl, webUrl)) return null;
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const orgId = typeof o.orgId === 'string' ? o.orgId : null;
  if (o.type === 'signed-out') return { type: 'signed-out' };
  if (o.type === 'org') return { type: 'org', orgId };
  if (o.type === 'session' && typeof o.refreshToken === 'string' && o.refreshToken.length > 20) {
    // The session is for our own API only, whatever the page claims.
    return { type: 'session', refreshToken: o.refreshToken, orgId, origin: new URL(webUrl).origin };
  }
  return null;
}

/** Where a tapped notification opens; only paths inside the app, never another site. */
export function notificationTarget(webUrl: string, data: unknown): string {
  const raw = (data as { url?: unknown } | null | undefined)?.url;
  const path =
    typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/app';
  return `${new URL(webUrl).origin}${path}`;
}
