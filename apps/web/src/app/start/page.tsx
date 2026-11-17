'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { AuthFrame } from '../../components/auth-frame';
import { ErrorBox, Field, Loading } from '../../components/ui';
import { type ApiError, get, post, type Schemas } from '../../lib/api';
import { useSession } from '../../lib/session';

type Org = Schemas['OrganizationSummary'];

/** After sign-up: create an organization, or apply to join a provider, then wait for approval. */
export default function StartPage() {
  const s = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Org[] | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<'provider' | 'contractor'>('provider');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (s.ready && !s.me) router.replace('/');
  }, [s.ready, s.me, router]);

  if (!s.ready || !s.me) return <Loading />;
  const pending = s.me.memberships.filter((m) => m.status === 'pending');
  const active = s.me.memberships.filter((m) => m.status === 'active');

  async function search(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await get<{ items: Org[] }>(`/organizations?q=${encodeURIComponent(q)}`, {
        org: null,
      });
      setFound(res.items);
    } catch (err) {
      setError(err as ApiError);
    }
  }

  async function apply(org: Org) {
    setBusy(true);
    setError(null);
    try {
      await post(`/organizations/${org.id}/applications`, undefined, { org: null });
      await s.reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<Schemas['CreatedOrganization']>(
        '/organizations',
        { name: name.trim(), type },
        { org: null },
      );
      s.chooseOrg(res.organization.id);
      await s.reload();
      router.replace('/app');
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={`Welcome, ${s.me.name}`}>
      <div className="stack">
        <ErrorBox error={error} />
        {active.length ? (
          <div className="card stack">
            <b>Your organizations</b>
            {active.map((m) => (
              <button
                key={m.id}
                className="btn ghost"
                onClick={() => {
                  s.chooseOrg(m.organization.id);
                  router.push('/app');
                }}
              >
                {m.organization.name}
              </button>
            ))}
          </div>
        ) : null}
        {pending.length ? (
          <div className="alert">
            Waiting for approval: {pending.map((m) => m.organization.name).join(', ')}. You will be
            notified when an admin decides.
          </div>
        ) : null}
        <div className="tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'join'}
            className={mode === 'join' ? 'on' : ''}
            onClick={() => setMode('join')}
          >
            Join a bakery
          </button>
          <button
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'on' : ''}
            onClick={() => setMode('create')}
          >
            Create an organization
          </button>
        </div>
        {mode === 'join' ? (
          <form className="stack" onSubmit={search}>
            <Field label="Bakery name">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                required
                placeholder="Search"
              />
            </Field>
            <button className="btn">Search</button>
            {found?.length === 0 ? <p className="muted">No bakery with that name.</p> : null}
            {found?.map((o) => (
              <div key={o.id} className="row between card">
                <span>{o.name}</span>
                <button type="button" className="btn" disabled={busy} onClick={() => apply(o)}>
                  Apply
                </button>
              </div>
            ))}
            <p className="muted small">
              To order as a contractor, create a contractor organization first, then apply from its
              Settings.
            </p>
          </form>
        ) : (
          <form className="stack" onSubmit={create}>
            <Field label="Organization name" error={error?.fields?.name}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </Field>
            <Field label="Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as 'provider' | 'contractor')}
              >
                <option value="provider">Bakery (makes and delivers products)</option>
                <option value="contractor">Contractor (orders from bakeries)</option>
              </select>
            </Field>
            <button className="btn big" disabled={busy}>
              Create
            </button>
          </form>
        )}
        <button
          className="btn ghost"
          onClick={() => {
            s.signOut();
            router.replace('/');
          }}
        >
          Sign out
        </button>
      </div>
    </AuthFrame>
  );
}
