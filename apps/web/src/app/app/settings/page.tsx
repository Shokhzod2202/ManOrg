'use client';

import { type FormEvent, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { type ApiError, del, get, patch, post, put, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { LanguagePicker, t } from '../../../lib/i18n';

type Access = Schemas['EmployeeAccess'];
type Bot = Schemas['BotAccess'];
type Org = Schemas['OrganizationSummary'];

export default function SettingsPage() {
  const s = useSession();
  const active = s.me?.memberships.filter((m) => m.status === 'active') ?? [];
  return (
    <div className="page">
      <PageHead title={t('Settings')} />
      <Account />
      <Language />
      <Telegram />
      {s.actor === 'employee' ? <ArrivalReminder /> : null}
      {s.actor === 'org_admin' ? <BakeryLocation /> : null}
      {active.length > 1 ? (
        <section className="card">
          <h2>{t('Organization')}</h2>
          <select
            className="input"
            value={s.orgId ?? ''}
            onChange={(e) => s.chooseOrg(e.target.value)}
            aria-label={t('Organization')}
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
          title={t('Employee access')}
          sub={t('What employees may read. Employees never edit orders.')}
          path="/organization/employee-access"
        />
      ) : null}
      {s.actor === 'org_admin' ? (
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
      setMsg(t('Saved.'));
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>{t('Account')}</h2>
      <span className="muted small">{s.me?.email}</span>
      <ErrorBox error={err} />
      <label className="field">
        {t('Name')}
        <input value={name} required maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn">{t('Save')}</button>
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
