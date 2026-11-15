'use client';

import { type FormEvent, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { type ApiError, get, patch, post, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';

type Access = Schemas['EmployeeAccess'];
type Bot = Schemas['BotAccess'];
type Org = Schemas['OrganizationSummary'];

export default function SettingsPage() {
  const s = useSession();
  const active = s.me?.memberships.filter((m) => m.status === 'active') ?? [];
  return (
    <div className="page">
      <PageHead title="Settings" />
      <Account />
      {active.length > 1 ? (
        <section className="card">
          <h2>Organization</h2>
          <select
            className="input"
            value={s.orgId ?? ''}
            onChange={(e) => s.chooseOrg(e.target.value)}
            aria-label="Organization"
          >
            {active.map((m) => (
              <option key={m.organization.id} value={m.organization.id}>
                {m.organization.name}
              </option>
            ))}
          </select>
        </section>
      ) : null}
      {s.actor === 'org_admin' ? (
        <Switches<Access>
          title="Employee access"
          sub="What employees may read. Employees never edit orders."
          path="/organization/employee-access"
        />
      ) : null}
      {s.actor === 'org_admin' ? (
        <Switches<Bot>
          title="Bot permissions"
          sub="The AI bot (phase 2) acts like an admin. It never deletes, creates organizations or changes these switches."
          path="/organization/bot-access"
        />
      ) : null}
      {s.actor === 'contractor_admin' ? <ApplyToProvider /> : null}
    </div>
  );
}

function Account() {
  const s = useSession();
  const [name, setName] = useState(s.me?.name ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await patch('/me', { name: name.trim() }, { org: null });
      await s.reload();
      setMsg('Saved.');
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>Account</h2>
      <span className="muted small">{s.me?.email}</span>
      <ErrorBox error={err} />
      <label className="field">
        Name
        <input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn">Save</button>
        {msg ? <span className="pill ok">{msg}</span> : null}
      </div>
    </form>
  );
}

/** EMP access (decision 2026-11-12) and bot switches (decision 2026-11-13); If-Match guards races. */
function Switches<T extends Access | Bot>({
  title,
  sub,
  path,
}: {
  title: string;
  sub: string;
  path: string;
}) {
  const { data, error, loading, setData } = useApi<T>(path);
  const [err, setErr] = useState<ApiError | null>(null);
  async function toggle(key: string, enabled: boolean) {
    if (!data) return;
    setErr(null);
    try {
      setData(await patch<T>(path, { [key]: enabled }, { ifMatch: data.version }));
    } catch (e) {
      setErr(e as ApiError);
      setData(await get<T>(path));
    }
  }
  return (
    <section className="card">
      <h2>{title}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {sub}
      </p>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} />
      {data?.areas.map((a) => (
        <label key={a.key} className="row between" style={{ minHeight: 44 }}>
          <span>{a.label}</span>
          <input
            type="checkbox"
            role="switch"
            checked={a.enabled}
            onChange={(e) => toggle(a.key, e.target.checked)}
            style={{ width: 22, height: 22 }}
          />
        </label>
      ))}
    </section>
  );
}

/** ACC-6: a contractor applies to buy from a bakery; it may buy from several. */
function ApplyToProvider() {
  const { orgId } = useSession();
  const providers = useApi<{ items: Org[] }>('/providers');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Org[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  async function search(e: FormEvent) {
    e.preventDefault();
    try {
      setFound(
        (await get<{ items: Org[] }>(`/organizations?q=${encodeURIComponent(q)}`, { org: null }))
          .items,
      );
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }
  async function apply(o: Org) {
    setErr(null);
    try {
      await post(`/organizations/${o.id}/applications`, undefined, { org: orgId });
      setMsg(`Applied to ${o.name}. You can order once they approve.`);
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>Bakeries</h2>
      {providers.data?.items.length ? (
        <div className="row wrap">
          {providers.data.items.map((p) => (
            <span key={p.id} className="chip">
              {p.name}
            </span>
          ))}
        </div>
      ) : (
        <Empty>No bakery has approved you yet.</Empty>
      )}
      <ErrorBox error={err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      <form className="row wrap" onSubmit={search}>
        <input
          className="input"
          required
          placeholder="Find a bakery"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
          aria-label="Bakery name"
        />
        <button className="btn">Search</button>
      </form>
      {found
        ?.filter((o) => o.type === 'provider')
        .map((o) => (
          <div key={o.id} className="row between">
            <span>{o.name}</span>
            <button className="btn ghost" onClick={() => apply(o)}>
              Apply to order
            </button>
          </div>
        ))}
    </section>
  );
}
