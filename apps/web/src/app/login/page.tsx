'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { ErrorBox, Field } from '../../components/ui';
import { type ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';

export default function LoginPage() {
  const s = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (s.ready && s.me) router.replace(s.membership ? '/app' : '/start');
  }, [s.ready, s.me, s.membership, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await s.signIn(email.trim(), password);
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Sign in">
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Email" error={error?.fields?.email}>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" error={error?.fields?.password}>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn big" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="muted center">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
