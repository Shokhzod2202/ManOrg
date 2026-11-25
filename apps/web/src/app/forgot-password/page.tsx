'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { ErrorBox, Field } from '../../components/ui';
import { api, type ApiError } from '../../lib/api';
import { t } from '../../lib/i18n';

/** Decided 2026-11-29: "Forgot password". The answer never says whether the email is known. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/auth/password-reset', { body: { email: email.trim() }, org: null });
      setSent(true);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('Forgot your password?')}>
      {sent ? (
        <div className="stack">
          <p role="status">
            {t(
              'If an account uses {email}, we sent it a link to choose a new password. The link works for 30 minutes. Check your spam folder too.',
              { email: email.trim() },
            )}
          </p>
          <button type="button" className="btn ghost" onClick={() => setSent(false)}>
            {t('Send it again')}
          </button>
          <Link className="btn" href="/login">
            {t('Back to sign in')}
          </Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <p className="muted" style={{ margin: 0 }}>
            {t(
              'Enter the email you sign in with. We will email you a link to choose a new password.',
            )}
          </p>
          <ErrorBox error={error} inlineFields />
          <Field label={t('Email')} error={error?.fields?.email}>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <button className="btn big" disabled={busy}>
            {busy ? t('Sending…') : t('Send reset link')}
          </button>
          <p className="muted center">
            <Link href="/login">{t('Back to sign in')}</Link>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
