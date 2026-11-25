'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { ErrorBox, Field, PasswordInput } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { t } from '../../lib/i18n';

/** Decided 2026-11-29: the page the emailed reset link opens. */
export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  useEffect(() => {
    // Read after loading, so the page renders the same on the server and here.
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token || password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/auth/password-reset/confirm', { body: { token, password }, org: null });
      setDone(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (token === '')
    return (
      <AuthFrame title={t('Choose a new password')}>
        <p>
          {t(
            'This link is not complete. Open the link from the email again, or ask for a new one.',
          )}
        </p>
        <Link className="btn" href="/forgot-password">
          {t('Ask for a new link')}
        </Link>
      </AuthFrame>
    );

  return (
    <AuthFrame title={t('Choose a new password')}>
      {done ? (
        <div className="stack">
          <p role="status">
            {t(
              'Your password is changed, and you were signed out on every device. Sign in with the new password.',
            )}
          </p>
          <Link className="btn big" href="/login">
            {t('Sign in')}
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <ErrorBox error={error} inlineFields />
          {error?.code === 'RESET_LINK_INVALID' ? (
            <Link href="/forgot-password">{t('Ask for a new link')}</Link>
          ) : null}
          <Field label={t('New password (at least 10 characters)')} error={error?.fields?.password}>
            <PasswordInput
              autoComplete="new-password"
              minLength={10}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field
            label={t('Type the password again')}
            error={mismatch ? [t('The passwords do not match.')] : undefined}
          >
            <PasswordInput
              autoComplete="new-password"
              required
              value={confirm}
              aria-invalid={mismatch}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <button
            className="btn big"
            disabled={busy || !token || !password || password !== confirm}
          >
            {busy ? t('Saving…') : t('Save new password')}
          </button>
        </form>
      )}
    </AuthFrame>
  );
}
