'use client';

import { colors, minTouchTarget, spacing } from '@manorg/ui';
import Script from 'next/script';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { apiV1 } from '../lib/api';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface Membership {
  id: string;
  role: string;
  status: string;
  organization: { id: string; name: string; type: string };
}

interface Me {
  id: string;
  name: string;
  email: string | null;
  telegramUserId: string | null;
  telegramUsername: string | null;
  memberships: Membership[];
}

interface Organization {
  id: string;
  name: string;
  type: string;
}

interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand?: () => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

const SESSION_KEY = 'manorg.session';

export function MiniApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [query, setQuery] = useState('Shohona');

  const loadMe = useCallback(async (tokens: Tokens) => {
    const response = await fetch(`${apiV1()}/me`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    if (response.status === 401 && tokens.refreshToken) {
      const refreshed = await fetch(`${apiV1()}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!refreshed.ok) {
        sessionStorage.removeItem(SESSION_KEY);
        return;
      }
      const next = (await refreshed.json()) as { tokens: Tokens };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next.tokens));
      await loadMe(next.tokens);
      return;
    }
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setMe((await response.json()) as Me);
  }, []);

  useEffect(() => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    void loadMe(JSON.parse(raw) as Tokens).catch(() => setError('Could not restore the session.'));
  }, [loadMe]);

  async function signInWithTelegram(initData: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiV1()}/auth/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ initData }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const body = (await response.json()) as { tokens: Tokens; provisioning: string };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(body.tokens));
      setNotice(provisioningNotice(body.provisioning));
      await loadMe(body.tokens);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function onTelegramReady() {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;
    webApp.ready();
    webApp.expand?.();
    if (webApp.initData) void signInWithTelegram(webApp.initData);
  }

  async function onEmailAuth(event: FormEvent<HTMLFormElement>, path: 'login' | 'register') {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload =
      path === 'login'
        ? { email: String(form.get('email') ?? ''), password: String(form.get('password') ?? '') }
        : {
            name: String(form.get('name') ?? ''),
            email: String(form.get('email') ?? ''),
            password: String(form.get('password') ?? ''),
          };
    try {
      const response = await fetch(`${apiV1()}/auth/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const body = (await response.json()) as { tokens: Tokens };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(body.tokens));
      await loadMe(body.tokens);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function searchOrganizations() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const tokens = JSON.parse(raw) as Tokens;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiV1()}/organizations?q=${encodeURIComponent(query)}`, {
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const body = (await response.json()) as { items: Organization[] };
      setOrganizations(body.items);
      if (body.items.length === 0) setNotice('No organization matches that name.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function applyTo(organizationId: string) {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const tokens = JSON.parse(raw) as Tokens;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiV1()}/organizations/${organizationId}/applications`, {
        method: 'POST',
        headers: { authorization: `Bearer ${tokens.accessToken}` },
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setNotice('Application sent. An admin has to approve it before you can work in that bakery.');
      await loadMe(tokens);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    setMe(null);
    setOrganizations([]);
    setNotice(null);
  }

  const openMembership = me?.memberships.some(
    (m) => m.status === 'pending' || m.status === 'active',
  );

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: spacing.xl, color: colors.text }}>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="afterInteractive"
        onLoad={onTelegramReady}
      />
      <h1>Organization Management</h1>
      <p style={{ color: colors.textMuted }}>
        Inside Telegram this page signs you in with your Telegram account. There is no guest login
        and no way to type a Telegram user id.
      </p>
      {error ? (
        <p
          role="alert"
          style={{ color: colors.flag, background: colors.flagSurface, padding: spacing.md }}
        >
          {error}
        </p>
      ) : null}
      {notice ? <p>{notice}</p> : null}
      {me ? (
        <section>
          <h2>Your account</h2>
          <p>
            {me.name}
            {me.telegramUsername ? ` (@${me.telegramUsername})` : ''}
          </p>
          <p>{me.email ?? 'No email on this account yet.'}</p>
          {me.telegramUserId ? <p>Telegram id {me.telegramUserId}</p> : null}
          <h3>Memberships</h3>
          {me.memberships.length === 0 ? <p>You are not in an organization yet.</p> : null}
          <ul>
            {me.memberships.map((membership) => (
              <li key={membership.id}>
                {membership.organization.name} ({membership.organization.type}): {membership.role},{' '}
                {membership.status}
              </li>
            ))}
          </ul>
          <p style={{ color: colors.textMuted }}>
            Shifts, punch cards, output, tasks, orders and deliveries are not in this release.
          </p>
          {!openMembership ? (
            <section>
              <h3>Apply to a bakery</h3>
              <label htmlFor="org-query">Organization name</label>
              <div style={{ display: 'flex', gap: spacing.sm, marginTop: spacing.sm }}>
                <input
                  id="org-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  style={{ minHeight: minTouchTarget, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void searchOrganizations()}
                  style={buttonStyle}
                >
                  Find
                </button>
              </div>
              <ul>
                {organizations.map((organization) => (
                  <li key={organization.id} style={{ marginTop: spacing.sm }}>
                    {organization.name} ({organization.type}){' '}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void applyTo(organization.id)}
                      style={buttonStyle}
                    >
                      Apply
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <button type="button" onClick={signOut} style={{ ...buttonStyle, marginTop: spacing.lg }}>
            Sign out
          </button>
        </section>
      ) : (
        <div style={{ display: 'grid', gap: spacing.lg }}>
          {busy ? <p>Signing in…</p> : null}
          <form onSubmit={(event) => void onEmailAuth(event, 'login')}>
            <h2>Sign in</h2>
            <Field
              idPrefix="login"
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
            />
            <Field
              idPrefix="login"
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              Sign in
            </button>
          </form>
          <form onSubmit={(event) => void onEmailAuth(event, 'register')}>
            <h2>Create account</h2>
            <Field idPrefix="register" label="Name" name="name" type="text" autoComplete="name" />
            <Field
              idPrefix="register"
              label="Email"
              name="email"
              type="email"
              autoComplete="username"
            />
            <Field
              idPrefix="register"
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
            />
            <button type="submit" disabled={busy} style={buttonStyle}>
              Create account
            </button>
          </form>
        </div>
      )}
    </main>
  );
}

function Field({
  idPrefix,
  label,
  name,
  type,
  autoComplete,
}: {
  idPrefix: string;
  label: string;
  name: string;
  type: string;
  autoComplete: string;
}) {
  const id = `${idPrefix}-${name}`;
  return (
    <div style={{ display: 'grid', gap: spacing.xs, marginBottom: spacing.sm }}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        style={{ minHeight: minTouchTarget }}
      />
    </div>
  );
}

const buttonStyle = {
  minHeight: minTouchTarget,
  padding: `0 ${spacing.md}px`,
  borderRadius: 8,
  border: `1px solid ${colors.primary}`,
  background: colors.primary,
  color: colors.onPrimary,
  fontWeight: 600,
} as const;

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

function provisioningNotice(provisioning: string): string {
  switch (provisioning) {
    case 'created_organization':
      return 'You are the admin of the bakery. Other Telegram users are not admins.';
    case 'joined_organization':
      return 'Your Telegram account was added as an admin of the existing bakery.';
    case 'already_member':
      return 'Signed in. Your existing membership was left as it is.';
    case 'skipped_other_organization':
      return 'This Telegram account already belongs to an organization, so it was not made a bakery admin.';
    default:
      return 'Signed in. This account is not an admin until someone approves it.';
  }
}
