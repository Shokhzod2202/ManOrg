'use client';

import { type FormEvent, useState } from 'react';
import { confirmAction } from '../../../components/confirm';
import { MoreMenu } from '../../../components/menu';
import { Avatar, Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { type ApiError, del, formatDate, patch, post, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { refreshApi, useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Member = Schemas['Member'];
type Application = Schemas['Application'];
type Team = Schemas['Team'];

/** Decided 2026-11-30: removing someone or making them an owner can be undone for 3 days. */
const UNDO_MS = 3 * 86_400_000;
const undoable = (at: string | null | undefined) =>
  !!at && Date.now() - new Date(at).getTime() < UNDO_MS;
const undoLeft = (at: string) => {
  const hours = Math.max(1, Math.ceil((new Date(at).getTime() + UNDO_MS - Date.now()) / 3_600_000));
  return hours >= 24
    ? t('{n} days left', { n: Math.ceil(hours / 24) })
    : t('{n} hours left', { n: hours });
};

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
    if (
      !ok &&
      !(await confirmAction(t('Reject this application? They can apply again after 7 days.'), {
        confirmLabel: t('Reject'),
        danger: true,
      }))
    )
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
  const { membership } = useSession();
  const iAmOwner = membership?.owner === true;
  const removed = useApi<{ items: Member[] }>('/members?status=removed');
  const active = useApi<{ items: Member[] }>('/members');
  const [to, setTo] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const items = [...(removed.data?.items ?? [])].sort((a, b) =>
    (b.removedAt ?? '').localeCompare(a.removedAt ?? ''),
  );
  if (!items.length) return null;

  async function undo(m: Member) {
    const name = m.displayName || m.user.name;
    const ok = await confirmAction(t('Undo removing {name}?', { name }), {
      detail: t(
        'They become a member again. Work you already handed over stays with its new person.',
      ),
      confirmLabel: t('Undo remove'),
    });
    if (!ok) return;
    setErr(null);
    setBusy(m.id);
    try {
      await post(`/members/${m.id}/restore`);
      removed.reload();
      active.reload();
      refreshApi('/members', '/teams', '/shifts', '/dashboard');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  const employees = (active.data?.items ?? []).filter((m) => m.role === 'employee');

  async function act(m: Member, toUserId: string | null) {
    const target = employees.find((e) => e.user.id === toUserId);
    const targetName = target ? target.displayName || target.user.name : '';
    const question = toUserId
      ? t(
          'Give {name}’s weekly shifts, teams, open and repeating tasks, ingredient ordering and products to {to}? Their past work stays as it is.',
          { name: m.displayName || m.user.name, to: targetName },
        )
      : t(
          'Take {name} out of the weekly shifts, teams, open and repeating tasks, ingredient ordering and products? Their past work stays as it is.',
          { name: m.displayName || m.user.name },
        );
    if (!(await confirmAction(question))) return;
    setErr(null);
    setBusy(m.id);
    try {
      const r = await post<HandOver>(`/members/${m.id}/hand-over`, { toUserId });
      setDone(
        t('Done for {name}: {what}.', {
          name: m.displayName || m.user.name,
          what: holdings(r) || t('nothing was left'),
        }),
      );
      // The person moves to Cleared once they hold nothing more.
      await removed.reload();
      refreshApi('/shifts', '/teams', '/tasks', '/recurring-tasks', '/dashboard', '/ingredients');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  const waiting = items.filter((m) => (m.leftover?.total ?? 1) > 0);
  const cleared = items.filter((m) => m.leftover?.total === 0);
  const undoButton = (m: Member) =>
    undoable(m.removedAt) && (iAmOwner || m.role === 'employee') ? (
      <span className="row" style={{ gap: 6 }}>
        <span className="muted small">{undoLeft(m.removedAt!)}</span>
        <button
          className="btn ghost small-btn"
          disabled={busy === m.id}
          onClick={() => void undo(m)}
        >
          {t('Undo remove')}
        </button>
      </span>
    ) : null;
  const who = (m: Member) => (
    <span className="row" style={{ gap: 10 }}>
      <Avatar name={m.user.name} url={m.user.avatarUrl} size={32} />
      <b>{m.displayName || m.user.name}</b>
      {m.removedAt ? (
        <span className="muted small">
          {t('removed {date}', { date: formatDate(m.removedAt.slice(0, 10)) })}
        </span>
      ) : null}
    </span>
  );

  return (
    <section className="card">
      <h2>{t('Removed members')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'Their past shifts, punches, output and tasks stay, marked removed. Hand what they still hold to another employee, or clear it.',
        )}
      </p>
      <ErrorBox error={removed.error ?? err} />
      {done ? (
        <span className="pill ok" role="status">
          {done}
        </span>
      ) : null}
      {waiting.map((m) => (
        <div key={m.id} className="stack removed-row" style={{ gap: 6 }}>
          <div className="row between wrap">
            {who(m)}
            {undoButton(m)}
          </div>
          {m.leftover ? (
            <span className="small" style={{ color: 'var(--warn-ink)' }}>
              {t('Still has: {what}', { what: holdings(m.leftover) })}
            </span>
          ) : null}
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
                  {e.displayName || e.user.name}
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
        </div>
      ))}
      {!waiting.length ? (
        <p className="muted small" style={{ margin: 0 }}>
          {t('Nothing left to hand over: everyone removed is cleared.')}
        </p>
      ) : null}
      {cleared.length ? (
        <details className="cleared">
          <summary>{t('Cleared ({n})', { n: cleared.length })}</summary>
          {cleared.map((m) => (
            <div key={m.id} className="row between wrap removed-row">
              {who(m)}
              {undoButton(m)}
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}

/** What a removed person still holds, as short parts ("3 shift days · 1 team"). */
function holdings(
  h: Pick<
    HandOver,
    'shiftDays' | 'teams' | 'tasks' | 'repeatingTasks' | 'ingredients' | 'products'
  >,
): string {
  const part = (n: number, one: string, many: string) =>
    n === 1 ? t(one) : n ? t(many, { n }) : '';
  return [
    part(h.shiftDays, '1 shift day', '{n} shift days'),
    part(h.teams, '1 team', '{n} teams'),
    part(h.tasks, '1 open task', '{n} open tasks'),
    part(h.repeatingTasks, '1 repeating task', '{n} repeating tasks'),
    part(h.ingredients, '1 ingredient to order', '{n} ingredients to order'),
    part(h.products, '1 product', '{n} products'),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Decided 2026-11-29: admins give each member a name used inside this organization (instead of
 * their account name) and a title. The account name stays visible here for reference.
 */
function NameCell({ member: m, onSaved }: { member: Member; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(m.displayName ?? '');
  const [title, setTitle] = useState(m.title ?? '');
  const [err, setErr] = useState<ApiError | null>(null);
  const shown = m.displayName || m.user.name;

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await patch(
        `/members/${m.id}`,
        { displayName: name.trim() || null, title: title.trim() || null },
        { ifMatch: m.version },
      );
      setOpen(false);
      onSaved();
      refreshApi('/shifts', '/teams', '/tasks', '/dashboard', '/output', '/colleagues');
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }

  if (open)
    return (
      <form className="stack" style={{ gap: 6 }} onSubmit={save}>
        <ErrorBox error={err} />
        <label className="field">
          {t('Name in this organization')}
          <input
            value={name}
            maxLength={100}
            placeholder={m.user.name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          {t('Title')}
          <input
            value={title}
            maxLength={60}
            placeholder={t('e.g. Head baker')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="row">
          <button className="btn">{t('Save')}</button>
          <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    );
  return (
    <span className="row" style={{ gap: 10 }}>
      <Avatar name={shown} url={m.user.avatarUrl} size={32} />
      <span className="stack" style={{ gap: 0 }}>
        <b>{shown}</b>
        {m.title ? <span className="small">{m.title}</span> : null}
        {m.displayName && m.displayName !== m.user.name ? (
          <span className="muted small">{t('Account: {name}', { name: m.user.name })}</span>
        ) : null}
      </span>
      <button
        type="button"
        className="btn ghost small-btn"
        aria-label={t('Edit name and title of {name}', { name: shown })}
        onClick={() => setOpen(true)}
      >
        {t('Edit')}
      </button>
    </span>
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
                <NameCell member={m} onSaved={() => void run(async () => undefined)} />
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
                {m.owner && m.ownerGrantedBy === me?.id && undoable(m.ownerGrantedAt) ? (
                  <button
                    className="btn ghost small-btn"
                    style={{ marginRight: 6 }}
                    onClick={async () => {
                      const name = m.displayName || m.user.name;
                      if (
                        await confirmAction(t('Undo making {name} an owner?', { name }), {
                          detail: t('They go back to the role they had before.'),
                          confirmLabel: t('Undo'),
                        })
                      )
                        void run(() => del(`/members/${m.id}/owner`));
                    }}
                    title={undoLeft(m.ownerGrantedAt!)}
                  >
                    {t('Undo')}
                  </button>
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
                    aria-label={t('Role of {name}', { name: m.displayName || m.user.name })}
                  >
                    <option value="employee">{t('Employee')}</option>
                    <option value="admin">{t('Admin')}</option>
                  </select>
                ) : (
                  <span className="pill">{m.role === 'admin' ? t('Admin') : t('Employee')}</span>
                )}
              </td>
              <td data-label="">
                <MemberActions
                  member={m}
                  self={m.user.id === me?.id}
                  iAmOwner={iAmOwner}
                  owners={(data?.items ?? []).filter((x) => x.owner).length}
                  run={run}
                />
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

/**
 * Decided 2026-11-30: "Make owner", "Remove" and "Stop being an owner" sit in the row's ⋯ menu
 * and each asks for confirmation; removing and making an owner can be undone for 3 days.
 */
function MemberActions({
  member: m,
  self,
  iAmOwner,
  owners,
  run,
}: {
  member: Member;
  self: boolean;
  iAmOwner: boolean;
  owners: number;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const name = m.displayName || m.user.name;
  const items = self
    ? m.owner && owners > 1
      ? [
          {
            label: t('Stop being an owner'),
            onSelect: async () => {
              if (
                await confirmAction(
                  t('Stop being an owner? You stay an admin; the other owners keep it.'),
                  { confirmLabel: t('Stop being an owner') },
                )
              )
                void run(() => del(`/members/${m.id}/owner`));
            },
          },
        ]
      : []
    : [
        ...(iAmOwner && !m.owner
          ? [
              {
                label: t('Make owner'),
                onSelect: async () => {
                  if (
                    await confirmAction(t('Make {name} an owner too?', { name }), {
                      detail: t(
                        'Owners change who is an admin and the bot permissions. You stay an owner. You can undo this for 3 days.',
                      ),
                      confirmLabel: t('Make owner'),
                    })
                  )
                    void run(() => post(`/members/${m.id}/owner`));
                },
              },
            ]
          : []),
        ...(!m.owner && (iAmOwner || m.role === 'employee')
          ? [
              {
                label: t('Remove'),
                danger: true,
                onSelect: async () => {
                  if (
                    await confirmAction(t('Remove {name}?', { name }), {
                      detail: t(
                        'Their past work stays, marked removed. You can undo this for 3 days under Removed members.',
                      ),
                      confirmLabel: t('Remove'),
                      danger: true,
                    })
                  )
                    void run(() =>
                      patch(`/members/${m.id}`, { status: 'removed' }, { ifMatch: m.version }),
                    );
                },
              },
            ]
          : []),
      ];
  return (
    <span className="row wrap" style={{ justifyContent: 'flex-end' }}>
      {self ? <span className="muted small">{t('You')}</span> : null}
      <MoreMenu label={t('More actions for {name}', { name })} items={items} />
    </span>
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
    if (
      !(await confirmAction(
        t('Delete team {name}? Output already logged stays.', { name: tm.name }),
        { confirmLabel: t('Delete'), danger: true },
      ))
    )
      return;
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
                {m.displayName || m.user.name}
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
