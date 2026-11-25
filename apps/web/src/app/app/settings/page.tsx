'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';
import { Avatar, Empty, ErrorBox, Loading, PageHead, PasswordInput } from '../../../components/ui';
import { api, type ApiError, del, get, patch, post, put, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { refreshApi, useApi } from '../../../lib/use-api';
import { LanguagePicker, t } from '../../../lib/i18n';

type Access = Schemas['EmployeeAccess'];
type Bot = Schemas['BotAccess'];
type Org = Schemas['OrganizationSummary'];

export default function SettingsPage() {
  const s = useSession();
  return (
    <div className="page">
      <PageHead title={t('Settings')} />
      <Account />
      <Organizations />
      <Language />
      <Telegram />
      {s.actor === 'employee' ? <ArrivalReminder /> : null}
      {s.actor === 'org_admin' ? <BakeryLocation /> : null}
      {s.actor === 'org_admin' ? (
        <Switches<Access>
          title={t('Employee access')}
          sub={t('What employees may read. Employees never edit orders.')}
          path="/organization/employee-access"
        />
      ) : null}
      {s.actor === 'org_admin' ? <WhoWorksShifts /> : null}
      {s.actor === 'org_admin' && s.membership?.owner ? (
        <Switches<Bot>
          title={t('Bot permissions')}
          sub={t(
            'The AI bot acts like an admin. It never deletes, creates organizations or changes these switches.',
          )}
          path="/organization/bot-access"
        />
      ) : null}
      {s.actor === 'contractor_admin' ? <ApplyToProvider /> : null}
    </div>
  );
}

const ROLE: Record<string, string> = { admin: 'Admin', employee: 'Employee' };

/**
 * Decided 2026-11-24: one person can belong to several organizations. Switch between them, create
 * a new one (you become its admin), or apply to join another as an employee.
 */
function Organizations() {
  const s = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'create' | 'join'>('none');
  const [name, setName] = useState('');
  const [type, setType] = useState<'provider' | 'contractor'>('provider');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Org[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const memberships = s.me?.memberships ?? [];
  const active = memberships.filter((m) => m.status === 'active');
  const pending = memberships.filter((m) => m.status === 'pending');
  const mine = new Set(
    memberships.filter((m) => m.status !== 'rejected').map((m) => m.organization.id),
  );

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await post<Schemas['CreatedOrganization']>(
        '/organizations',
        { name: name.trim(), type },
        { org: null },
      );
      await s.reload();
      s.chooseOrg(res.organization.id);
      router.push('/app');
    } catch (e2) {
      setErr(e2 as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const res = await get<{ items: Org[] }>(`/organizations?q=${encodeURIComponent(q)}`, {
        org: null,
      });
      setFound(res.items);
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }
  async function join(o: Org) {
    setBusy(true);
    setErr(null);
    try {
      // No organization chosen: the request is to join as an employee.
      await post(`/organizations/${o.id}/applications`, undefined, { org: null });
      await s.reload();
      setMsg(
        t('Applied to {name}. You can switch to it once an admin approves.', { name: o.name }),
      );
      setFound(null);
      setMode('none');
    } catch (e2) {
      setErr(e2 as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t('Your organizations')}</h2>
      <ErrorBox error={err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      {active.map((m) => {
        const here = m.organization.id === s.orgId;
        return (
          <div key={m.organization.id} className="row between wrap">
            <span>
              <b>{m.organization.name}</b>{' '}
              <span className="muted small">
                · {t(ROLE[m.role] ?? m.role)} ·{' '}
                {m.organization.type === 'contractor' ? t('Contractor') : t('Organization')}
              </span>
            </span>
            {here ? (
              <span className="pill ok">{t('Open now')}</span>
            ) : (
              <button
                className="btn ghost"
                onClick={() => {
                  s.chooseOrg(m.organization.id);
                  router.push('/app');
                }}
              >
                {t('Switch')}
              </button>
            )}
          </div>
        );
      })}
      {pending.map((m) => (
        <div key={m.organization.id} className="row between wrap">
          <span>
            <b>{m.organization.name}</b>
          </span>
          <span className="pill warn">{t('Waiting for approval')}</span>
        </div>
      ))}
      <div className="row wrap">
        <button
          className="btn ghost"
          onClick={() => setMode(mode === 'create' ? 'none' : 'create')}
        >
          {t('Create a new organization')}
        </button>
        <button className="btn ghost" onClick={() => setMode(mode === 'join' ? 'none' : 'join')}>
          {t('Join another organization')}
        </button>
      </div>
      {mode === 'create' ? (
        <form className="stack" onSubmit={create}>
          <label className="field">
            {t('Organization name')}
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field">
            {t('Type')}
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'provider' | 'contractor')}
            >
              <option value="provider">{t('Organization (makes and delivers products)')}</option>
              <option value="contractor">{t('Contractor (orders from organizations)')}</option>
            </select>
          </label>
          <span className="muted small">
            {t('You become its admin. Your other organizations stay as they are.')}
          </span>
          <button className="btn" disabled={busy || !name.trim()}>
            {t('Create')}
          </button>
        </form>
      ) : null}
      {mode === 'join' ? (
        <form className="stack" onSubmit={search}>
          <label className="field">
            {t('Organization name')}
            <input
              required
              value={q}
              placeholder={t('Search')}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <button className="btn">{t('Search')}</button>
          <span className="muted small">
            {t('You apply as an employee. An admin of that organization approves you.')}
          </span>
          {found?.length === 0 ? (
            <p className="muted">{t('No organization with that name.')}</p>
          ) : null}
          {found?.map((o) => (
            <div key={o.id} className="row between">
              <span>{o.name}</span>
              {mine.has(o.id) ? (
                <span className="muted small">{t('Already yours')}</span>
              ) : (
                <button type="button" className="btn" disabled={busy} onClick={() => void join(o)}>
                  {t('Apply')}
                </button>
              )}
            </div>
          ))}
        </form>
      ) : null}
    </section>
  );
}

/**
 * Decided 2026-11-26: admins do not work shifts unless switched on here. Switched on, an admin
 * shows in the shift editor and timesheets and has a punch card and hours like an employee. Any
 * admin can switch it for any admin, themselves included.
 */
function WhoWorksShifts() {
  const s = useSession();
  const { data, error, loading, reload, setData } = useApi<{ items: Schemas['Member'][] }>(
    '/members',
  );
  const [err, setErr] = useState<ApiError | null>(null);
  const admins = (data?.items ?? []).filter((m) => m.role === 'admin');

  async function toggle(m: Schemas['Member'], on: boolean) {
    setErr(null);
    // Shown at once; put back by the reload if the server refuses.
    setData({
      ...data!,
      items: data!.items.map((x) => (x.id === m.id ? { ...x, worksShifts: on } : x)),
    });
    try {
      await patch(`/members/${m.id}`, { worksShifts: on }, { ifMatch: m.version });
      reload();
      refreshApi('/shifts', '/dashboard', '/members');
      if (m.user.id === s.me?.id) await s.reload();
    } catch (e) {
      setErr(e as ApiError);
      reload();
    }
  }

  return (
    <section className="card">
      <h2>{t('Admins who work shifts')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'Employees always work shifts. Switch on an admin who also works: they appear in the shift editor and timesheets, and get a punch card and their own hours.',
        )}
      </p>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} />
      {admins.map((m) => (
        <label key={m.id} className="row between" style={{ minHeight: 44 }}>
          <span>
            {m.user.name}
            {m.user.id === s.me?.id ? <span className="muted small"> · {t('You')}</span> : null}
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={m.worksShifts}
            aria-label={t('{name} works shifts', { name: m.user.name })}
            onChange={(e) => void toggle(m, e.target.checked)}
            style={{ width: 22, height: 22 }}
          />
        </label>
      ))}
    </section>
  );
}

/** Phase 3: English, Korean or Uzbek, kept on the account so the phone app and web match. */
function Language() {
  const s = useSession();
  return (
    <section className="card">
      <h2>{t('Language')}</h2>
      <span className="muted small">
        {t('Screens, dates and messages show in this language on every device you sign in on.')}
      </span>
      <LanguagePicker onChange={(l) => s.setLanguage(l)} />
    </section>
  );
}

/**
 * Decided 2026-11-25: each person manages their own account here: picture, name, email, password,
 * and signing out on every device. An account made through Telegram adds its first email and
 * password here.
 */
function Account() {
  const s = useSession();
  const router = useRouter();
  const me = s.me;
  const [name, setName] = useState(me?.name ?? '');
  const [section, setSection] = useState<'none' | 'email' | 'password'>('none');
  const [email, setEmail] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const picture = useRef<HTMLInputElement>(null);
  if (!me) return null;
  const hasPassword = me.hasPassword;

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      await s.reload();
      setMsg(done);
      setSection('none');
      setCurrent('');
      setPassword('');
      setConfirm('');
      setEmail('');
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    await run(() => patch('/me', { name: name.trim() }, { org: null }), t('Saved.'));
  }
  async function saveEmail(e: FormEvent) {
    e.preventDefault();
    await run(
      () =>
        patch(
          '/me',
          { email: email.trim(), ...(hasPassword ? { currentPassword: current } : {}) },
          { org: null },
        ),
      t('Email saved. Use it to sign in from now on.'),
    );
  }
  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return;
    await run(async () => {
      await patch(
        '/me',
        { password, ...(hasPassword ? { currentPassword: current } : {}) },
        { org: null },
      );
      // A changed password ends every session; this device signs in again with the new one.
      if (hasPassword && me?.email) await s.signIn(me.email, password);
    }, t('Password saved. Other devices are signed out.'));
  }
  async function upload(file: File) {
    const form = new FormData();
    form.append('file', file);
    await run(() => api('POST', '/me/avatar', { form, org: null }), t('Picture saved.'));
  }
  async function signOutEverywhere() {
    if (!window.confirm(t('Sign out on every device, this one too?'))) return;
    try {
      await post('/me/sign-out-everywhere', undefined, { org: null });
    } finally {
      s.signOut();
      router.replace('/');
    }
  }

  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <section className="card">
      <h2>{t('Account')}</h2>
      <ErrorBox error={err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      <div className="row wrap" style={{ gap: 14 }}>
        <Avatar name={me.name} url={me.avatarUrl} size={72} />
        <div className="row wrap">
          <input
            ref={picture}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <button className="btn ghost" disabled={busy} onClick={() => picture.current?.click()}>
            {me.avatarUrl ? t('Change picture') : t('Add a picture')}
          </button>
          {me.avatarUrl ? (
            <button
              className="btn ghost"
              disabled={busy}
              onClick={() =>
                void run(() => del('/me/avatar', { org: null }), t('Picture removed.'))
              }
            >
              {t('Remove picture')}
            </button>
          ) : null}
        </div>
      </div>
      <form className="row wrap" onSubmit={saveName} style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          {t('Name')}
          <input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn" disabled={busy || !name.trim() || name.trim() === me.name}>
          {t('Save')}
        </button>
      </form>

      <div className="row between wrap">
        <span>
          <b>{t('Email')}</b>
          <br />
          <span className="muted">{me.email ?? t('No email yet')}</span>
        </span>
        <button
          className="btn ghost"
          onClick={() => setSection(section === 'email' ? 'none' : 'email')}
        >
          {me.email ? t('Change email') : t('Add email')}
        </button>
      </div>
      {section === 'email' ? (
        <form className="stack" onSubmit={saveEmail}>
          <label className="field">
            {t('New email')}
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {hasPassword ? (
            <label className="field">
              {t('Current password')}
              <PasswordInput
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
          ) : null}
          <button className="btn" disabled={busy}>
            {t('Save email')}
          </button>
        </form>
      ) : null}

      <div className="row between wrap">
        <span>
          <b>{t('Password')}</b>
          <br />
          <span className="muted">{hasPassword ? '••••••••••' : t('No password yet')}</span>
        </span>
        <button
          className="btn ghost"
          onClick={() => setSection(section === 'password' ? 'none' : 'password')}
        >
          {hasPassword ? t('Change password') : t('Set a password')}
        </button>
      </div>
      {section === 'password' ? (
        !me.email ? (
          <span className="muted small">
            {t('Add an email first: you sign in with it and the password.')}
          </span>
        ) : (
          <form className="stack" onSubmit={savePassword}>
            {hasPassword ? (
              <label className="field">
                {t('Current password')}
                <PasswordInput
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </label>
            ) : null}
            <label className="field">
              {t('New password (at least 10 characters)')}
              <PasswordInput
                autoComplete="new-password"
                minLength={10}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field">
              {t('Type the password again')}
              <PasswordInput
                autoComplete="new-password"
                required
                value={confirm}
                aria-invalid={mismatch}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch ? <span className="err">{t('The passwords do not match.')}</span> : null}
            </label>
            <button className="btn" disabled={busy || !password || password !== confirm}>
              {t('Save password')}
            </button>
          </form>
        )
      ) : null}

      <div className="row between wrap">
        <span className="muted small">
          {t('Lost a phone, or signed in on a shared computer? End every session.')}
        </span>
        <button className="btn ghost" onClick={() => void signOutEverywhere()}>
          {t('Sign out on all devices')}
        </button>
      </div>
    </section>
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
      setData(await put<T>(path, { [key]: enabled }, { ifMatch: data.version }));
    } catch (e) {
      setErr(e as ApiError);
      setData(await get<T>(path));
    }
  }
  return (
    <section className="card">
      <h2>{t(title)}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(sub)}
      </p>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} />
      {data?.areas.map((a) => (
        <label key={a.key} className="row between" style={{ minHeight: 44 }}>
          <span>{t(a.label)}</span>
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
      setMsg(t('Applied to {name}. You can order once they approve.', { name: o.name }));
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>{t('Bakeries')}</h2>
      {providers.data?.items.length ? (
        <div className="row wrap">
          {providers.data.items.map((p) => (
            <span key={p.id} className="chip">
              {p.name}
            </span>
          ))}
        </div>
      ) : (
        <Empty>{t('No bakery has approved you yet.')}</Empty>
      )}
      <ErrorBox error={err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      <form className="row wrap" onSubmit={search}>
        <input
          className="input"
          required
          placeholder={t('Find a bakery')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
          aria-label={t('Bakery name')}
        />
        <button className="btn">{t('Search')}</button>
      </form>
      {found
        ?.filter((o) => o.type === 'provider')
        .map((o) => (
          <div key={o.id} className="row between">
            <span>{o.name}</span>
            <button className="btn ghost" onClick={() => apply(o)}>
              {t('Apply to order')}
            </button>
          </div>
        ))}
    </section>
  );
}

/** Telegram alongside the app (decided 2026-11-13): the same notifications, in a chat. */
function Telegram() {
  const { data, error, loading, reload } = useApi<Schemas['TelegramStatus']>('/me/telegram');
  const [err, setErr] = useState<ApiError | null>(null);
  const [waiting, setWaiting] = useState(false);

  async function connect() {
    setErr(null);
    // Open the window first so phone browsers do not block it, then point it at the bot.
    const win = window.open('', '_blank');
    try {
      const link = await post<Schemas['TelegramLink']>('/me/telegram/link', undefined, {
        org: null,
      });
      if (win) win.location.href = link.url;
      else window.location.href = link.url;
      setWaiting(true);
      // Check back while the person presses Start in Telegram.
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        const s = await get<Schemas['TelegramStatus']>('/me/telegram', { org: null });
        if (s.connected) break;
      }
    } catch (e) {
      win?.close();
      setErr(e as ApiError);
    } finally {
      setWaiting(false);
      reload();
    }
  }

  async function disconnect() {
    setErr(null);
    try {
      await del('/me/telegram', { org: null });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <section className="card">
      <h2>{t('Telegram')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'Get your notifications in Telegram too: new tasks, order changes, deliveries and reminders.',
        )}
      </p>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} />
      {data && !data.available ? (
        <Empty>{t('Telegram is not set up on this server yet.')}</Empty>
      ) : null}
      {data?.available && data.connected ? (
        <div className="row between wrap">
          <span className="pill ok">Connected{data.username ? ` as @${data.username}` : ''}</span>
          <button className="btn ghost" onClick={disconnect}>
            {t('Disconnect')}
          </button>
        </div>
      ) : null}
      {data?.available && !data.connected ? (
        <div className="stack">
          <button className="btn" onClick={connect} disabled={waiting}>
            {waiting ? t('Waiting for Telegram…') : t('Connect Telegram')}
          </button>
          <span className="muted small">
            {t('Telegram opens @{bot}. Press Start there and come back.', {
              bot: data.botUsername,
            })}
          </span>
        </div>
      ) : null}
    </section>
  );
}

/** Spec section 9: the employee turns the arrival reminder off or on. */
function ArrivalReminder() {
  const s = useSession();
  const on = s.me?.preferences?.arrivalPrompt !== false;
  const [err, setErr] = useState<ApiError | null>(null);
  async function toggle(value: boolean) {
    setErr(null);
    try {
      await patch('/me', { preferences: { arrivalPrompt: value } }, { org: null });
      await s.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>{t('Arrival reminder')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'The Haydar phone app can remind you “You came to work. Start shift” when you arrive before a planned shift. It never starts your shift by itself, and your location is never sent or stored.',
        )}
      </p>
      <ErrorBox error={err} />
      <label className="row between" style={{ minHeight: 44 }}>
        <span>{t('Remind me when I arrive')}</span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => void toggle(e.target.checked)}
          style={{ width: 22, height: 22 }}
        />
      </label>
    </section>
  );
}

/** Spec section 9: where the bakery is, the radius, and when the arrival reminder may show. */
function BakeryLocation() {
  const { data, error, loading, setData } =
    useApi<Schemas['OrganizationLocation']>('/organization/location');
  const [form, setForm] = useState<{
    lat: string;
    lng: string;
    radius: number;
    before: number;
    after: number;
  } | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const f =
    form ??
    (data
      ? {
          lat: data.latitude?.toString() ?? '',
          lng: data.longitude?.toString() ?? '',
          radius: data.radiusM,
          before: data.windowBeforeMin,
          after: data.windowAfterMin,
        }
      : null);

  async function save(changes: Record<string, unknown>) {
    if (!data) return;
    setErr(null);
    setMsg(null);
    try {
      setData(
        await put<Schemas['OrganizationLocation']>('/organization/location', changes, {
          ifMatch: data.version,
        }),
      );
      setForm(null);
      setMsg(t('Saved.'));
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  function here() {
    if (!navigator.geolocation) return setMsg(t('This device cannot share its location.'));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        f &&
        setForm({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
      () => setMsg(t('Location was not shared. Type the coordinates instead.')),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <section className="card">
      <h2>{t('Bakery location')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'The phone app reminds employees “You came to work. Start shift” when they arrive within the radius before a planned shift. It never punches by itself, and employees’ locations are never stored.',
        )}
      </p>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      {data && f ? (
        <>
          <label className="row between" style={{ minHeight: 44 }}>
            <span>{t('Arrival reminder on')}</span>
            <input
              type="checkbox"
              role="switch"
              checked={data.enabled}
              onChange={(e) => void save({ enabled: e.target.checked })}
              style={{ width: 22, height: 22 }}
            />
          </label>
          <div className="grid2">
            <label className="field">
              {t('Latitude')}
              <input
                inputMode="decimal"
                value={f.lat}
                onChange={(e) => setForm({ ...f, lat: e.target.value })}
              />
            </label>
            <label className="field">
              {t('Longitude')}
              <input
                inputMode="decimal"
                value={f.lng}
                onChange={(e) => setForm({ ...f, lng: e.target.value })}
              />
            </label>
            <label className="field">
              {t('Radius (metres)')}
              <input
                type="number"
                min={30}
                max={1000}
                value={f.radius}
                onChange={(e) => setForm({ ...f, radius: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              {t('Remind from (minutes before the shift)')}
              <input
                type="number"
                min={0}
                max={240}
                value={f.before}
                onChange={(e) => setForm({ ...f, before: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              {t('Until (minutes after the start)')}
              <input
                type="number"
                min={0}
                max={240}
                value={f.after}
                onChange={(e) => setForm({ ...f, after: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="row wrap">
            <button className="btn ghost" type="button" onClick={here}>
              {t('Use this device’s location')}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!form}
              onClick={() =>
                save({
                  latitude: f.lat.trim() === '' ? null : Number(f.lat),
                  longitude: f.lng.trim() === '' ? null : Number(f.lng),
                  radiusM: f.radius,
                  windowBeforeMin: f.before,
                  windowAfterMin: f.after,
                })
              }
            >
              {t('Save location')}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
