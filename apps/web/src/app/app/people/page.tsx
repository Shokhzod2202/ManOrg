'use client';

import { type FormEvent, useState } from 'react';
import { Avatar, Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { type ApiError, del, formatDate, patch, post, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { refreshApi, useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Member = Schemas['Member'];
type Application = Schemas['Application'];
type Team = Schemas['Team'];

export default function PeoplePage() {
  const { actor } = useSession();
  const provider = actor === 'org_admin';
  return (
    <div className="page">
      <PageHead title={provider ? t('People and teams') : t('Admins')} />
      {provider ? <Applications /> : null}
      <Members provider={provider} />
      {provider ? <RemovedMembers /> : null}
      {provider ? <Teams /> : null}
    </div>
  );
}

/** ACC-3, ACC-6: approve or reject employee and contractor applications. */
function Applications() {
  const { data, error, reload } = useApi<{ items: Application[] }>('/applications', 60_000);
  const [err, setErr] = useState<ApiError | null>(null);
  async function decide(id: string, ok: boolean) {
    if (!ok && !window.confirm(t('Reject this application? They can apply again after 7 days.')))
      return;
    setErr(null);
    try {
      await post(`/applications/${id}/${ok ? 'approve' : 'reject'}`);
      reload();
      // The new member shows at once in Members, team pickers and contractor lists.
      refreshApi('/members', '/teams', '/contractors', '/dashboard');
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>{t('Applications')}</h2>
      <ErrorBox error={error ?? err} />
      {data && !data.items.length ? <Empty>{t('No one is waiting.')}</Empty> : null}
      {data?.items.map((a) => (
        <div key={a.id} className="row between wrap">
          <span>
            <span className="pill blue">
              {a.kind === 'contractor' ? t('Contractor') : t('Employee')}
            </span>{' '}
            <b>{a.kind === 'contractor' ? a.contractor?.name : a.applicant?.name}</b>
            <span className="muted small">
              {' '}
              · {a.applicant?.email} · {formatDate(a.createdAt.slice(0, 10))}
            </span>
          </span>
          <span className="row">
            <button className="btn" onClick={() => decide(a.id, true)}>
              {t('Approve')}
            </button>
            <button className="btn ghost" onClick={() => decide(a.id, false)}>
              {t('Reject')}
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

/** ACC-7, ACC-8: members, roles and removal. Every change is audited on the server. */
type HandOver = {
  toUserId: string | null;
  shiftDays: number;
  shiftDaysKept: number;
  teams: number;
  tasks: number;
  repeatingTasks: number;
  ingredients: number;
  products: number;
};

/**
 * Decided 2026-11-28: someone removed keeps their history (shifts, punches, output, tasks), shown
 * as removed. Here the admin clears their future work, or hands it to another employee: the weekly
 * shift plan, teams, open and repeating tasks, ingredient ordering and the products they log.
 */
function RemovedMembers() {
  const removed = useApi<{ items: Member[] }>('/members?status=removed');
  const active = useApi<{ items: Member[] }>('/members');
  const [to, setTo] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, string>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const items = removed.data?.items ?? [];
  if (!items.length) return null;
  const employees = (active.data?.items ?? []).filter((m) => m.role === 'employee');

  async function act(m: Member, toUserId: string | null) {
    const target = employees.find((e) => e.user.id === toUserId)?.user.name;
    const question = toUserId
      ? t(
          'Give {name}’s weekly shifts, teams, open and repeating tasks, ingredient ordering and products to {to}? Their past work stays as it is.',
          { name: m.user.name, to: target ?? '' },
        )
      : t(
          'Take {name} out of the weekly shifts, teams, open and repeating tasks, ingredient ordering and products? Their past work stays as it is.',
          { name: m.user.name },
        );
    if (!window.confirm(question)) return;
    setErr(null);
    setBusy(m.id);
    try {
      const r = await post<HandOver>(`/members/${m.id}/hand-over`, { toUserId });
      setDone({
        ...done,
        [m.id]: t(
          'Done: {shifts} shift days, {teams} teams, {tasks} tasks, {rules} repeating tasks, {ingredients} ingredients, {products} products.',
          {
            shifts: r.shiftDays,
            teams: r.teams,
            tasks: r.tasks,
            rules: r.repeatingTasks,
            ingredients: r.ingredients,
            products: r.products,
          },
        ),
      });
      refreshApi('/shifts', '/teams', '/tasks', '/recurring-tasks', '/dashboard', '/ingredients');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <h2>{t('Removed members')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'Their past shifts, punches, output and tasks stay, marked removed. Clear what they still had for the future, or give it to another employee.',
        )}
      </p>
      <ErrorBox error={removed.error ?? err} />
      {items.map((m) => (
        <div key={m.id} className="stack" style={{ gap: 6 }}>
          <div className="row between wrap">
            <span className="row" style={{ gap: 10 }}>
              <Avatar name={m.user.name} url={m.user.avatarUrl} size={32} />
              <b>{m.user.name}</b>
              {m.removedAt ? (
                <span className="muted small">
                  {t('removed {date}', { date: formatDate(m.removedAt.slice(0, 10)) })}
                </span>
              ) : null}
            </span>
          </div>
          <div className="row wrap">
            <select
              className="input"
              style={{ width: 'auto', minWidth: 180 }}
              value={to[m.id] ?? ''}
              onChange={(e) => setTo({ ...to, [m.id]: e.target.value })}
              aria-label={t('Hand over to')}
            >
              <option value="">{t('Hand over to…')}</option>
              {employees.map((e) => (
                <option key={e.user.id} value={e.user.id}>
                  {e.user.name}
                </option>
              ))}
            </select>
            <button
              className="btn ghost"
              disabled={!to[m.id] || busy === m.id}
              onClick={() => void act(m, to[m.id] ?? null)}
            >
              {t('Hand over')}
            </button>
            <button
              className="btn ghost"
              disabled={busy === m.id}
              onClick={() => void act(m, null)}
            >
              {t('Remove from shifts and teams')}
            </button>
          </div>
          {done[m.id] ? <span className="pill ok">{done[m.id]}</span> : null}
        </div>
      ))}
    </section>
  );
}

function Members({ provider }: { provider: boolean }) {
  const { me, membership } = useSession();
  // Decided 2026-11-26/27: only owners make, demote or remove admins; ownership is shared.
  const iAmOwner = membership?.owner === true;
  const { data, error, loading, reload } = useApi<{ items: Member[] }>('/members');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'employee'>(iAmOwner ? 'admin' : 'employee');
  const [err, setErr] = useState<ApiError | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      reload();
      refreshApi('/members', '/teams', '/shifts', '/dashboard');
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    await run(() =>
      post('/members', {
        email: email.trim(),
        role: provider && iAmOwner ? role : provider ? 'employee' : 'admin',
      }),
    );
    setEmail('');
  }

  return (
    <section className="card">
      <h2>{t('Members')}</h2>
      <ErrorBox error={error ?? err} />
      {loading && !data ? <Loading /> : null}
      <table className="t cards">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th>{t('Email')}</th>
            <th>{t('Role')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.items.map((m) => (
            <tr key={m.id}>
              <td data-label={t('Name')}>
                <span className="row" style={{ gap: 10 }}>
                  <Avatar name={m.user.name} url={m.user.avatarUrl} size={32} />
                  <b>{m.user.name}</b>
                </span>
              </td>
              <td data-label={t('Email')} className="small">
                {m.user.email}
              </td>
              <td data-label={t('Role')}>
                {m.owner ? (
                  <span className="pill blue" style={{ marginRight: 6 }}>
                    {t('Owner')}
                  </span>
                ) : null}
                {provider && iAmOwner && m.user.id !== me?.id && !m.owner ? (
                  <select
                    className="input"
                    value={m.role}
                    onChange={(e) =>
                      run(() =>
                        patch(`/members/${m.id}`, { role: e.target.value }, { ifMatch: m.version }),
                      )
                    }
                    aria-label={t('Role of {name}', { name: m.user.name })}
                  >
                    <option value="employee">{t('Employee')}</option>
                    <option value="admin">{t('Admin')}</option>
                  </select>
                ) : (
                  <span className="pill">{m.role === 'admin' ? t('Admin') : t('Employee')}</span>
                )}
              </td>
              <td data-label="">
                {m.user.id === me?.id ? (
                  <span className="row wrap" style={{ justifyContent: 'flex-end' }}>
                    <span className="muted small">{t('You')}</span>
                    {m.owner && (data?.items ?? []).filter((x) => x.owner).length > 1 ? (
                      <button
                        className="btn ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                'Stop being an owner? You stay an admin; the other owners keep it.',
                              ),
                            )
                          )
                            void run(() => del(`/members/${m.id}/owner`));
                        }}
                      >
                        {t('Stop being an owner')}
                      </button>
                    ) : null}
                  </span>
                ) : (
                  <span className="row wrap" style={{ justifyContent: 'flex-end' }}>
                    {iAmOwner && !m.owner ? (
                      <button
                        className="btn ghost"
                        onClick={() => {
                          if (
                            window.confirm(
                              t(
                                'Make {name} an owner too? Owners change who is an admin and the bot permissions. You stay an owner.',
                                { name: m.user.name },
                              ),
                            )
                          )
                            void run(() => post(`/members/${m.id}/owner`));
                        }}
                      >
                        {t('Make owner')}
                      </button>
                    ) : null}
                    {!m.owner && (iAmOwner || m.role === 'employee') ? (
                      <button
                        className="btn ghost"
                        onClick={() => {
                          if (window.confirm(t('Remove {name}?', { name: m.user.name })))
                            void run(() =>
                              patch(
                                `/members/${m.id}`,
                                { status: 'removed' },
                                { ifMatch: m.version },
                              ),
                            );
                        }}
                      >
                        {t('Remove')}
                      </button>
                    ) : null}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!provider && !iAmOwner ? null : (
        <form className="row wrap" onSubmit={add}>
          <input
            className="input"
            type="email"
            required
            placeholder={t('Email of an existing account')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ flex: 1, minWidth: 200 }}
            aria-label={t('Email')}
          />
          {provider && iAmOwner ? (
            <select
              className="input"
              value={role}
              onChange={(e) => setRole(e.target.value as 'admin' | 'employee')}
              aria-label={t('Role')}
            >
              <option value="admin">{t('Admin')}</option>
              <option value="employee">{t('Employee')}</option>
            </select>
          ) : null}
          <button className="btn">{t('Add')}</button>
        </form>
      )}
      {!iAmOwner ? (
        <span className="muted small">{t('Only an owner can make, demote or remove admins.')}</span>
      ) : null}
    </section>
  );
}

/** OUT-3 with admin-made shared teams (decision 2026-11-14). */
function Teams() {
  const { data, error, reload } = useApi<{ items: Team[] }>('/teams');
  const members = useApi<{ items: Member[] }>('/members');
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<ApiError | null>(null);

  function start(tm: Team | 'new') {
    setEditing(tm);
    setName(tm === 'new' ? '' : tm.name);
    setChosen(new Set(tm === 'new' ? [] : tm.members.map((m) => m.id)));
  }
  async function save() {
    setErr(null);
    try {
      if (editing === 'new')
        await post('/teams', { name: name.trim(), shared: true, memberIds: [...chosen] });
      else if (editing)
        await patch(
          `/teams/${editing.id}`,
          { name: name.trim(), memberIds: [...chosen] },
          { ifMatch: editing.version },
        );
      setEditing(null);
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  async function remove(tm: Team) {
    if (!window.confirm(`Delete team ${tm.name}? Output already logged stays.`)) return;
    try {
      await del(`/teams/${tm.id}`, { ifMatch: tm.version });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  const employees = (members.data?.items ?? []).filter(
    (m) => m.role === 'employee' && m.status === 'active',
  );

  return (
    <section className="card">
      <div className="row between">
        <h2>{t('Teams')}</h2>
        <button className="btn ghost" onClick={() => start('new')}>
          {t('New team')}
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'People who work together. Output logged for a team is counted once and shared equally.',
        )}
      </p>
      <ErrorBox error={error ?? err} />
      {data && !data.items.length && !editing ? <Empty>{t('No teams yet.')}</Empty> : null}
      {data?.items.map((tm) => (
        <div key={tm.id} className="row between wrap">
          <span>
            <b>{tm.name}</b>{' '}
            {tm.shared ? (
              <span className="pill blue">{t('Shared')}</span>
            ) : (
              <span className="pill">{t('Private')}</span>
            )}
            <br />
            <span className="muted small">
              {tm.members
                .map((m) => (m.removed ? t('{name} (removed)', { name: m.name }) : m.name))
                .join(', ')}
            </span>
          </span>
          <span className="row">
            <button className="btn ghost" onClick={() => start(tm)}>
              {t('Edit')}
            </button>
            <button className="btn ghost" onClick={() => remove(tm)}>
              {t('Delete')}
            </button>
          </span>
        </div>
      ))}
      {editing ? (
        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <label className="field">
            {t('Team name')}
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="row wrap">
            {employees.map((m) => (
              <label key={m.user.id} className="chip">
                <input
                  type="checkbox"
                  checked={chosen.has(m.user.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(m.user.id);
                    else n.delete(m.user.id);
                    setChosen(n);
                  }}
                />
                {m.user.name}
              </label>
            ))}
            {/* Removed from the organization: shown so the admin can take them off (2026-11-28). */}
            {(editing && editing !== 'new' && members.data
              ? editing.members.filter(
                  (x) => x.removed || !new Set(employees.map((e) => e.user.id)).has(x.id),
                )
              : []
            ).map((x) => (
              <label key={x.id} className="chip removed">
                <input
                  type="checkbox"
                  checked={chosen.has(x.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(x.id);
                    else n.delete(x.id);
                    setChosen(n);
                  }}
                />
                {t('{name} (removed)', { name: x.name })}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="btn" disabled={!name.trim() || chosen.size < 2} onClick={save}>
              {t('Save team')}
            </button>
            <button className="btn ghost" onClick={() => setEditing(null)}>
              {t('Cancel')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
