'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { ErrorBox, Field } from '../../components/ui';
import { type ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';

export default function RegisterPage() {
  const s = useSession();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
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
    <AuthFrame title="Create an account">
      <form className="stack" onSubmit={submit}>
        <ErrorBox error={error} />
        <Field label="Your name" error={error?.fields?.name}>
          <input
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Email" error={error?.fields?.email}>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password (at least 10 characters)" error={error?.fields?.password}>
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <button className="btn big" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted center">
          Have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </AuthFrame>
  );
}
