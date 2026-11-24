'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { ErrorBox, Field, PasswordInput } from '../../components/ui';
import { type ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { t } from '../../lib/i18n';

export default function RegisterPage() {
  const s = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== password;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await s.register(name.trim(), email.trim(), password);
      router.replace('/start');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={t('Create an account')}>
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label={t('Your name')} error={error?.fields?.name}>
          <input
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={t('Email')} error={error?.fields?.email}>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label={t('Password (at least 10 characters)')} error={error?.fields?.password}>
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
        <button className="btn big" disabled={busy || !password || confirm !== password}>
          {busy ? t('Creating…') : t('Create account')}
        </button>
        <p className="muted center">
          {t('Have an account?')} <Link href="/login">{t('Sign in')}</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
