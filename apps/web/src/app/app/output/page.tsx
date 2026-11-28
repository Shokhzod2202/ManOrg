'use client';

import { confirmAction } from '../../../components/confirm';
import { sortProducts, useProductSort } from '../../../lib/product-sort';
import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Flag, Loading, PageHead } from '../../../components/ui';
import {
  type ApiError,
  del,
  formatDate,
  formatMinutes,
  patch,
  post,
  put,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { flagText, getLocale, INTL, t } from '../../../lib/i18n';
import { won } from '../../../components/orders/value';
import Link from 'next/link';

type Product = Schemas['Product'];
type Team = Schemas['Team'];
type History = Schemas['OutputHistory'];
type ShiftOutput = Schemas['ShiftOutputDashboard'];

export default function OutputPage() {
  const { actor } = useSession();
  return actor === 'org_admin' ? <AdminOutput /> : <MyOutput />;
}

/** OUT-1 to OUT-4: personal lines, or team lines counted once and shared equally. */
function MyOutput() {
  const { me } = useSession();
  const [date, setDate] = useState(today());
  const products = useApi<{ items: Product[] }>(me ? `/employees/${me.id}/products` : null);
  const [productSort] = useProductSort();
  const teams = useApi<{ items: Team[] }>('/teams');
  const history = useApi<History>(`/output?from=${date}&to=${date}`);
  const [mode, setMode] = useState<string>('personal');
  const [qty, setQty] = useState<Record<string, Record<string, number>>>({});
  const [cleaning, setCleaning] = useState(0);
  const [err, setErr] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const day = history.data?.days.find((d) => d.date === date);
    const next: Record<string, Record<string, number>> = { personal: {} };
    day?.personal.forEach(
      (l) => ((next.personal as Record<string, number>)[l.productId] = l.quantity),
    );
    day?.team.forEach((l) => {
      next[l.team.id] ??= {};
      (next[l.team.id] as Record<string, number>)[l.productId] = l.quantity;
    });
    setQty(next);
    setCleaning(day?.cleaningHours ?? 0);
  }, [history.data, date]);

  async function save() {
    setErr(null);
    setSaved(false);
    try {
      const lines = Object.entries(qty).flatMap(([key, m]) =>
        Object.entries(m)
          .filter(([, q]) => q > 0)
          .map(([productId, quantity]) => ({
            productId,
            quantity,
            teamId: key === 'personal' ? null : key,
          })),
      );
      await put(`/output/${date}`, { lines, cleaningHours: cleaning });
      setSaved(true);
      history.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const day = history.data?.days.find((d) => d.date === date);
  // Decided 2026-11-30: in the person's chosen product sort.
  const list = sortProducts(products.data?.items ?? [], productSort, (p) => ({
    name: p.name,
    sortOrder: p.sortOrder,
    typeName: p.type?.name ?? null,
  }));
  const current = qty[mode] ?? {};

  return (
    <div className="page">
      <PageHead
        title={t('Output')}
        sub={t('A shift counts on the day it started, so a night shift shows on the day before.')}
      >
        <input
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Date')}
        />
      </PageHead>
      <ErrorBox error={products.error ?? history.error ?? err} />
      {day ? (
        <div className="kpis">
          <div className="kpi">
            <b>{Math.round(day.creditedQuantity * 10) / 10}</b>
            <span>{t('Items credited')}</span>
          </div>
          <div className="kpi">
            <b>{formatMinutes(Math.round(day.expectedMinutes))}</b>
            <span>{t('Expected time')}</span>
          </div>
          <div className="kpi">
            <b>{t('{n} h', { n: day.cleaningHours })}</b>
            <span>{t('Cleaning')}</span>
          </div>
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label={t('Log for')}>
        <button
          role="tab"
          aria-selected={mode === 'personal'}
          className={mode === 'personal' ? 'on' : ''}
          onClick={() => setMode('personal')}
        >
          {t('Just me')}
        </button>
        {teams.data?.items.map((tm) => (
          <button
            key={tm.id}
            role="tab"
            aria-selected={mode === tm.id}
            className={mode === tm.id ? 'on' : ''}
            onClick={() => setMode(tm.id)}
          >
            {t('Team {name}', { name: tm.name })}
          </button>
        ))}
      </div>
      {mode !== 'personal' ? (
        <p className="muted center small">
          {t('Team numbers are counted once and shared equally: {names}.', {
            names:
              teams.data?.items
                .find((tm) => tm.id === mode)
                ?.members.map((m) => m.name)
                .join(', ') ?? '',
          })}
        </p>
      ) : null}
      {products.loading ? <Loading /> : null}
      {products.data && !list.length ? (
        <Empty>{t('No products are assigned to you yet. Ask your admin.')}</Empty>
      ) : null}
      {list.length ? (
        <div className="card" style={{ padding: 8 }}>
          {list.map((p) => (
            <div
              key={p.id}
              className="row between"
              style={{ padding: '6px 8px', borderBottom: '1px solid #f1f3f8' }}
            >
              <span className="row">
                <img className="thumb" src={p.imageUrl} alt="" />
                {p.name}
              </span>
              <input
                className="input qty"
                type="number"
                min={0}
                inputMode="numeric"
                aria-label={t('{name} made', { name: p.name })}
                value={current[p.id] ?? ''}
                onChange={(e) =>
                  setQty({
                    ...qty,
                    [mode]: { ...current, [p.id]: Math.max(0, Number(e.target.value)) },
                  })
                }
              />
            </div>
          ))}
          <div className="row between" style={{ padding: '10px 8px' }}>
            <span>{t('Cleaning hours')}</span>
            <input
              className="input qty"
              type="number"
              min={0}
              max={24}
              step={0.25}
              value={cleaning}
              onChange={(e) => setCleaning(Number(e.target.value))}
              aria-label={t('Cleaning hours')}
            />
          </div>
        </div>
      ) : null}
      <MyTeams onChange={teams.reload} />
      <button className="btn big" onClick={save} disabled={!list.length}>
        {t('Save output')}
      </button>
      {saved ? (
        <span className="pill ok" style={{ alignSelf: 'center' }}>
          {t('Saved')}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Decided 2026-11-26: Output opens on every employee's latest output. Choosing an employee shows
 * their month: what their output brought the organization ("efficiency"). One day for everyone
 * is still one tab away.
 */
function AdminOutput() {
  const [who, setWho] = useState('');
  const [view, setView] = useState<'latest' | 'day'>('latest');
  // Decided 2026-11-28: an employee opens on their output day by day; Efficiency is one tab over.
  const [personView, setPersonView] = useState<'days' | 'efficiency'>('days');
  const pick = (id: string, next: 'days' | 'efficiency') => {
    setWho(id);
    setPersonView(next);
    window.scrollTo({ top: 0 });
  };
  const members = useApi<{ items: Schemas['Member'][] }>('/members');
  const employees = (members.data?.items ?? []).filter(
    (m) => m.role === 'employee' && m.status === 'active',
  );
  return (
    <div className="page wide">
      <PageHead
        title={t('Output')}
        sub={t('A shift counts on the day it started, so a night shift shows on the day before.')}
      >
        <select
          className="input"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label={t('Employee')}
        >
          <option value="">{t('All employees')}</option>
          {employees.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.displayName || m.user.name}
            </option>
          ))}
        </select>
        {who ? (
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={personView === 'days'}
              className={personView === 'days' ? 'on' : ''}
              onClick={() => setPersonView('days')}
            >
              {t('Day by day')}
            </button>
            <button
              role="tab"
              aria-selected={personView === 'efficiency'}
              className={personView === 'efficiency' ? 'on' : ''}
              onClick={() => setPersonView('efficiency')}
            >
              {t('Efficiency')}
            </button>
          </div>
        ) : null}
        {!who ? (
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={view === 'latest'}
              className={view === 'latest' ? 'on' : ''}
              onClick={() => setView('latest')}
            >
              {t('Latest')}
            </button>
            <button
              role="tab"
              aria-selected={view === 'day'}
              className={view === 'day' ? 'on' : ''}
              onClick={() => setView('day')}
            >
              {t('By day')}
            </button>
          </div>
        ) : null}
      </PageHead>
      {who && personView === 'days' ? (
        <EmployeeDays key={who} employeeId={who} onBack={() => setWho('')} />
      ) : who ? (
        <Efficiency key={who} employeeId={who} onBack={() => setWho('')} />
      ) : view === 'latest' ? (
        <LatestOutput
          onDays={(id) => pick(id, 'days')}
          onEfficiency={(id) => pick(id, 'efficiency')}
        />
      ) : (
        <DayOutput />
      )}
    </div>
  );
}

/** Decided 2026-11-26: each employee's latest day with output, latest first. */
function LatestOutput({
  onDays,
  onEfficiency,
}: {
  onDays: (id: string) => void;
  onEfficiency: (id: string) => void;
}) {
  const { data, error, loading, reload } = useApi<Schemas['LatestOutput']>(
    '/dashboard/output-latest',
    60_000,
  );
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <section className="card">
      <h2>{t('Latest output')}</h2>
      {!data.employees.length ? <Empty>{t('No employees yet.')}</Empty> : null}
      <table className="t cards latest-output">
        <thead>
          <tr>
            <th>{t('Name')}</th>
            <th>{t('Last output')}</th>
            <th>{t('Worked')}</th>
            <th>{t('Items')}</th>
            <th>{t('Expected')}</th>
            <th>{t('Cleaning')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.employees
            .filter((e) => e.date)
            .map((e) => (
              <tr key={e.employee.id}>
                <td data-label={t('Name')}>
                  {/* Decided 2026-11-28: the name opens their output day by day. */}
                  <button
                    type="button"
                    className="name-link"
                    onClick={() => onDays(e.employee.id)}
                    aria-label={t('{name}: output day by day', { name: e.employee.name })}
                  >
                    <b>{e.employee.name}</b>
                    {e.employee.title ? (
                      <span className="muted small"> · {e.employee.title}</span>
                    ) : null}
                    <span aria-hidden="true"> ›</span>
                  </button>
                </td>
                <td data-label={t('Last output')}>
                  {e.date ? (
                    <>
                      {formatDate(e.date)}
                      {e.date === data.today ? (
                        <span className="muted small"> · {t('today')}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted small">{t('Nothing in the last 60 days')}</span>
                  )}
                </td>
                <td data-label={t('Worked')}>{e.output ? formatMinutes(e.workedMinutes) : '—'}</td>
                <td data-label={t('Items')}>
                  {e.output ? Math.round(e.output.creditedQuantity * 10) / 10 : '—'}
                </td>
                <td data-label={t('Expected')}>
                  {e.output ? formatMinutes(Math.round(e.output.expectedMinutes)) : '—'}
                </td>
                <td data-label={t('Cleaning')}>
                  {e.output ? t('{n} h', { n: e.output.cleaningHours }) : '—'}
                </td>
                <td data-label="">
                  <button
                    type="button"
                    className="btn ghost small-btn"
                    onClick={() => onEfficiency(e.employee.id)}
                  >
                    {t('Efficiency')}
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {/* Decided 2026-11-26: people without recent output on one line, not a card each. */}
      {data.employees.some((e) => !e.date) ? (
        <div className="no-output">
          <span className="muted small">{t('No output in the last 60 days:')}</span>
          {data.employees
            .filter((e) => !e.date)
            .map((e) => (
              <button
                key={e.employee.id}
                type="button"
                className="chip"
                onClick={() => onDays(e.employee.id)}
              >
                {e.employee.name}
              </button>
            ))}
        </div>
      ) : null}
    </section>
  );
}

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};

/** Expected time ÷ time worked (cleaning left out): 100% is the expected pace. */
function pace(expected: number, worked: number, cleaningHours: number): number | null {
  const making = worked - cleaningHours * 60;
  return making > 0 && expected > 0 ? Math.round((expected / making) * 100) : null;
}

/**
 * Decided 2026-11-28: one employee's output day by day for a month, newest first: what they made
 * (personal and their share of team work), hours worked (punch cards, finished shifts), expected
 * time, pace, pieces per hour and cleaning, with the month's totals on top.
 */
function EmployeeDays({ employeeId, onBack }: { employeeId: string; onBack: () => void }) {
  const [month, setMonth] = useState(today().slice(0, 7));
  const { from, to } = monthRange(month);
  const out = useApi<Schemas['OutputHistory']>(
    `/output?employee_id=${employeeId}&from=${from}&to=${to}`,
  );
  const hours = useApi<Schemas['WorkHoursMonth']>(
    `/work-hours?month=${month}&employee_id=${employeeId}`,
  );
  const worked = new Map((hours.data?.people[0]?.days ?? []).map((d) => [d.date, d.minutes]));
  const days = (out.data?.days ?? [])
    .map((d) => ({ ...d, worked: worked.get(d.date) ?? 0 }))
    .filter((d) => d.personal.length || d.team.length || d.cleaningHours > 0 || d.worked > 0)
    .reverse();
  const sum = (f: (d: (typeof days)[number]) => number) => days.reduce((n, d) => n + f(d), 0);
  const total = {
    items: Math.round(sum((d) => d.creditedQuantity) * 10) / 10,
    worked: sum((d) => d.worked),
    expected: Math.round(sum((d) => d.expectedMinutes)),
    cleaning: sum((d) => d.cleaningHours),
  };
  // Pace and items per hour only from days with finished hours, so a missing End Shift does not
  // make the month look faster than it was.
  const timed = days.filter((d) => d.worked > 0);
  const timedItems = timed.reduce((n, d) => n + d.creditedQuantity, 0);
  const totalPace = pace(
    timed.reduce((n, d) => n + d.expectedMinutes, 0),
    total.worked,
    timed.reduce((n, d) => n + d.cleaningHours, 0),
  );
  const loading = (out.loading && !out.data) || (hours.loading && !hours.data);
  const fmtPace = (p: number | null) => (p == null ? '—' : `${p}%`);
  const perHour = (items: number, minutes: number) =>
    minutes > 0 ? String(Math.round((items / (minutes / 60)) * 10) / 10) : '—';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="viewbar">
        <button type="button" className="btn ghost small-btn" onClick={onBack}>
          ← {t('All employees')}
        </button>
        <div className="month-switch">
          <button
            className="btn ghost"
            aria-label={t('Previous month')}
            onClick={() => setMonth(shiftMonth(month, -1))}
          >
            ‹
          </button>
          <b>{monthLabel(month)}</b>
          <button
            className="btn ghost"
            aria-label={t('Next month')}
            disabled={month >= today().slice(0, 7)}
            onClick={() => setMonth(shiftMonth(month, 1))}
          >
            ›
          </button>
        </div>
      </div>
      {loading ? <Loading /> : null}
      <ErrorBox error={out.error ?? hours.error} onRetry={out.reload} />
      {out.data && !loading ? (
        <>
          <section className="card day-summary">
            <h2>{out.data.employee.name}</h2>
            <div className="day-stats">
              <Stat label={t('Days')} value={String(days.length)} />
              <Stat label={t('Items')} value={String(total.items)} />
              <Stat label={t('Worked')} value={formatMinutes(total.worked)} />
              <Stat label={t('Expected')} value={formatMinutes(total.expected)} />
              <Stat label={t('Pace')} value={fmtPace(totalPace)} />
              <Stat label={t('Items per hour')} value={perHour(timedItems, total.worked)} />
              <Stat label={t('Cleaning')} value={t('{n} h', { n: total.cleaning })} />
            </div>
            <span className="muted small">
              {t(
                'Pace is the expected time for what was made ÷ the time worked (cleaning left out); 100% is on pace.',
              )}
            </span>
            {timed.length < days.filter((d) => d.creditedQuantity > 0).length ? (
              <span className="hint-bad">
                {t('{n} days with output have no finished shift and are left out of pace.', {
                  n: days.filter((d) => d.creditedQuantity > 0 && d.worked === 0).length,
                })}
              </span>
            ) : null}
          </section>
          {!days.length ? <Empty>{t('No output this month.')}</Empty> : null}
          {days.map((d) => {
            const dayPace = pace(d.expectedMinutes, d.worked, d.cleaningHours);
            return (
              <section key={d.date} className="card day-card" data-testid="output-day">
                <div className="row between wrap">
                  <h3 className="day-title">
                    {formatDate(d.date)}
                    {d.date === today() ? (
                      <span className="muted small"> · {t('today')}</span>
                    ) : null}
                  </h3>
                  <span
                    className={dayPace == null ? 'pill' : dayPace >= 100 ? 'pill ok' : 'pill warn'}
                  >
                    {t('Pace')} {fmtPace(dayPace)}
                  </span>
                </div>
                <div className="day-stats">
                  <Stat
                    label={t('Items')}
                    value={String(Math.round(d.creditedQuantity * 10) / 10)}
                  />
                  <Stat label={t('Worked')} value={formatMinutes(d.worked)} />
                  <Stat
                    label={t('Expected')}
                    value={formatMinutes(Math.round(d.expectedMinutes))}
                  />
                  <Stat label={t('Items per hour')} value={perHour(d.creditedQuantity, d.worked)} />
                  <Stat label={t('Cleaning')} value={t('{n} h', { n: d.cleaningHours })} />
                </div>
                {d.worked === 0 && (d.personal.length || d.team.length) ? (
                  <span className="hint-bad">
                    {t('No finished shift this day: hours count once the shift is ended.')}
                  </span>
                ) : null}
                {d.personal.length || d.team.length ? (
                  <ul className="batch-list">
                    {d.personal.map((l) => (
                      <li key={`p${l.productId}`}>
                        <span>{l.name}</span>
                        <b>{l.quantity}</b>
                      </li>
                    ))}
                    {d.team.map((l) => (
                      <li key={`t${l.team.id}${l.productId}`}>
                        <span>
                          {l.name}{' '}
                          <span className="muted small">
                            · {t('team {team}: {n} in all', { team: l.team.name, n: l.quantity })}
                          </span>
                        </span>
                        <b>{l.creditedQuantity}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="muted small">{t('Nothing logged.')}</span>
                )}
              </section>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="stat">
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </span>
  );
}

/**
 * Decided 2026-11-26: one employee's month. For each product they made: price minus ingredient
 * cost minus their labor (owners only; others see it before labor), by day, and per hour worked.
 */
function Efficiency({ employeeId, onBack }: { employeeId: string; onBack: () => void }) {
  const { membership } = useSession();
  const owner = membership?.owner === true;
  const [month, setMonth] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Schemas['Efficiency']>(
    `/output/efficiency?employee_id=${employeeId}${month ? `&month=${month}` : ''}`,
  );
  const shown = month ?? data?.month ?? null;
  const thisMonth = today().slice(0, 7);
  const money = (n: number | null | undefined) => (n == null ? '—' : won(n));
  const tone = (n: number) => (n < 0 ? 'neg' : 'pos');
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="viewbar">
        <button type="button" className="btn ghost small-btn" onClick={onBack}>
          ← {t('All employees')}
        </button>
        <div className="month-switch">
          <button
            className="btn ghost"
            aria-label={t('Previous month')}
            disabled={!shown}
            onClick={() => shown && setMonth(shiftMonth(shown, -1))}
          >
            ‹
          </button>
          <b>{shown ? monthLabel(shown) : '…'}</b>
          <button
            className="btn ghost"
            aria-label={t('Next month')}
            disabled={!shown || shown >= thisMonth}
            onClick={() => shown && setMonth(shiftMonth(shown, 1))}
          >
            ›
          </button>
        </div>
      </div>
      {loading ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !loading ? (
        <>
          <section className="card eff-head">
            <span className="muted">
              {t('{name} brought in', { name: data.employee.name })}
              {!data.labor ? ` (${t('before labor cost')})` : ''}
            </span>
            <b className={`eff-big ${tone(data.totals.contribution)}`} data-testid="eff-total">
              {won(data.totals.contribution)}
            </b>
            <span className="muted small">
              {data.totals.perHour != null
                ? t('{amount} per hour · {hours} worked', {
                    amount: won(data.totals.perHour),
                    hours: formatMinutes(data.minutes),
                  })
                : t('No finished shifts this month.')}
            </span>
            <div className="eff-kpis">
              <span>
                {t('Pieces')} <b>{data.totals.quantity}</b>
              </span>
              <span>
                {t('Sales value')} <b>{won(data.totals.revenue)}</b>
              </span>
              <span>
                {t('Ingredients')} <b>−{won(data.totals.ingredientCost)}</b>
              </span>
              {data.labor ? (
                <span>
                  {t('Labor')} <b>−{money(data.totals.laborCost)}</b>
                  {data.hourlyRate != null ? (
                    <span className="muted small">
                      {' '}
                      ({t('{amount}/h', { amount: won(data.hourlyRate) })})
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
            {!data.labor ? (
              owner ? (
                <Link className="hint-bad" href="/app/hours">
                  {t('Set {name}’s hourly cost in Work hours to include labor.', {
                    name: data.employee.name,
                  })}
                </Link>
              ) : (
                <span className="muted small">{t('Labor cost is shown to owners only.')}</span>
              )
            ) : null}
            {data.missing.daysWithoutHours ? (
              <span className="hint-bad">
                {t(
                  '{n} days have output but no finished shift, so their labor is not counted. End those shifts in Shifts.',
                  { n: data.missing.daysWithoutHours },
                )}
              </span>
            ) : null}
            {data.missing.prices ? (
              <span className="hint-bad">
                {t('{n} products have no price and count as ₩0.', { n: data.missing.prices })}
              </span>
            ) : null}
            {data.missing.costs ? (
              <Link className="hint-bad" href="/app/products">
                {t('{n} products have no ingredient cost yet (set it in Products).', {
                  n: data.missing.costs,
                })}
              </Link>
            ) : null}
          </section>
          <section className="card">
            <h2>{t('By product')}</h2>
            {!data.products.length ? <Empty>{t('No output this month.')}</Empty> : null}
            <table className="t cards">
              <thead>
                <tr>
                  <th>{t('Product')}</th>
                  <th>{t('Pieces')}</th>
                  <th>{t('Sales value')}</th>
                  <th>{t('Ingredients')}</th>
                  {data.labor ? <th>{t('Labor')}</th> : null}
                  <th>{t('Result')}</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.productId}>
                    <td data-label={t('Product')}>
                      <b>{p.name}</b>
                      {p.unitPrice != null ? (
                        <span className="muted small"> · {won(p.unitPrice)}</span>
                      ) : null}
                    </td>
                    <td data-label={t('Pieces')}>{p.quantity}</td>
                    <td data-label={t('Sales value')}>{won(p.revenue)}</td>
                    <td data-label={t('Ingredients')}>−{won(p.ingredientCost)}</td>
                    {data.labor ? <td data-label={t('Labor')}>−{money(p.laborCost)}</td> : null}
                    <td data-label={t('Result')}>
                      <b className={tone(p.contribution)}>{won(p.contribution)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.labor && data.totals.unassignedLabor ? (
              <span className="muted small">
                {t('Hours on days without output cost {amount}; they are in the total.', {
                  amount: won(data.totals.unassignedLabor),
                })}
              </span>
            ) : null}
          </section>
          <section className="card">
            <h2>{t('By day')}</h2>
            {!data.days.length ? <Empty>{t('No output this month.')}</Empty> : null}
            <table className="t">
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date)}</td>
                    <td className="muted small">{formatMinutes(d.minutes)}</td>
                    <td className="muted small">{t('{n} pieces', { n: d.quantity })}</td>
                    <td style={{ textAlign: 'right' }}>
                      <b className={tone(d.contribution)}>{won(d.contribution)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="muted small">
              {t(
                'At today’s prices and ingredient costs; labor at the hourly cost of each day. Team output is shared equally.',
              )}
            </span>
          </section>
        </>
      ) : null}
    </div>
  );
}

const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(INTL[getLocale()], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** DSH-3: who made what on one day, with hours and flags. */
function DayOutput() {
  const [date, setDate] = useState(today());
  const { data, error, loading, reload } = useApi<ShiftOutput>(
    `/dashboard/shift-output?date=${date}`,
    60_000,
  );
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="viewbar">
        <input
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Date')}
        />
      </div>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data ? (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <section className="card">
            <h2>{t('By employee')}</h2>
            {!data.employees.length ? <Empty>{t('No one worked on this day.')}</Empty> : null}
            <table className="t cards">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Worked')}</th>
                  <th>{t('Items')}</th>
                  <th>{t('Expected')}</th>
                  <th>{t('Cleaning')}</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((e) => (
                  <tr key={e.employee.id}>
                    <td data-label={t('Name')}>
                      <b>{e.employee.name}</b>
                      {e.employee.title ? (
                        <span className="muted small"> · {e.employee.title}</span>
                      ) : null}
                      {e.removedOn ? (
                        <span className="pill warn" style={{ marginLeft: 6 }}>
                          {t('Removed')}
                        </span>
                      ) : null}
                      {e.flags.map((f) => (
                        <div key={f.code}>
                          <Flag>{flagText(f)}</Flag>
                        </div>
                      ))}
                    </td>
                    <td data-label={t('Worked')}>
                      <div className="worked-cell">
                        <span>
                          {formatMinutes(e.workedMinutes)}
                          {e.onShift ? (
                            <span className="pill" style={{ marginLeft: 6 }}>
                              {t('still on shift')}
                            </span>
                          ) : null}
                        </span>
                        {/* Decided 2026-11-26: a shift is counted on the day it started. */}
                        {e.carriedOver ? (
                          <button
                            type="button"
                            className="carried"
                            onClick={() => setDate(e.carriedOver!.startedOn)}
                          >
                            {e.carriedOver.ongoing
                              ? t('Shift from {date} not ended yet', {
                                  date: formatDate(e.carriedOver.startedOn),
                                })
                              : t('Night shift from {date}: {time}, counted on that day', {
                                  date: formatDate(e.carriedOver.startedOn),
                                  time: formatMinutes(e.carriedOver.minutes),
                                })}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td data-label={t('Items')}>
                      {Math.round(e.output.creditedQuantity * 10) / 10}
                    </td>
                    <td data-label={t('Expected')}>
                      {formatMinutes(Math.round(e.output.expectedMinutes))}
                    </td>
                    <td data-label={t('Cleaning')}>{t('{n} h', { n: e.output.cleaningHours })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card">
            <h2>{t('Products made')}</h2>
            {!data.totals.length ? <Empty>{t('Nothing logged.')}</Empty> : null}
            <table className="t">
              <tbody>
                {[...data.totals]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((tm) => (
                    <tr key={tm.productId}>
                      <td>{tm.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        <b>{tm.quantity}</b>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </div>
  );
}

/** OUT-4, OUT-5: an employee's own saved teams (admins' shared teams appear too, read-only). */
function MyTeams({ onChange }: { onChange: () => void }) {
  const { me } = useSession();
  const teams = useApi<{ items: Team[] }>('/teams');
  const people = useApi<{ items: { id: string; name: string }[] }>('/colleagues');
  const [editing, setEditing] = useState<Team | 'new' | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<ApiError | null>(null);

  function start(tm: Team | 'new') {
    setEditing(tm);
    setName(tm === 'new' ? '' : tm.name);
    setChosen(
      new Set(tm === 'new' ? [] : tm.members.map((m) => m.id).filter((id) => id !== me?.id)),
    );
  }
  async function save() {
    setErr(null);
    try {
      const memberIds = [...chosen];
      if (editing === 'new') await post('/teams', { name: name.trim(), memberIds });
      else if (editing)
        await patch(
          `/teams/${editing.id}`,
          { name: name.trim(), memberIds },
          { ifMatch: editing.version },
        );
      setEditing(null);
      teams.reload();
      onChange();
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
      teams.reload();
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  const others = (people.data?.items ?? []).filter((p) => p.id !== me?.id);

  return (
    <section className="card">
      <div className="row between">
        <h2>{t('My teams')}</h2>
        <button className="btn ghost" onClick={() => start('new')}>
          {t('New team')}
        </button>
      </div>
      <ErrorBox error={teams.error ?? err} />
      {teams.data && !teams.data.items.length && !editing ? (
        <Empty>
          {t('Make a team for people you often work with, then log output for it above.')}
        </Empty>
      ) : null}
      {teams.data?.items.map((tm) => (
        <div key={tm.id} className="row between wrap">
          <span>
            <b>{tm.name}</b>{' '}
            {tm.shared ? <span className="pill blue">{t('From admin')}</span> : null}
            <br />
            <span className="muted small">
              {tm.members
                .map((m) => (m.removed ? t('{name} (removed)', { name: m.name }) : m.name))
                .join(', ')}
            </span>
          </span>
          {!tm.shared ? (
            <span className="row">
              <button className="btn ghost" onClick={() => start(tm)}>
                {t('Edit')}
              </button>
              <button className="btn ghost" onClick={() => remove(tm)}>
                {t('Delete')}
              </button>
            </span>
          ) : null}
        </div>
      ))}
      {editing ? (
        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <label className="field">
            {t('Team name')}
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <span className="muted small">
            {t('You are in the team. Choose who works with you:')}
          </span>
          <div className="row wrap">
            {others.map((p) => (
              <label key={p.id} className="chip">
                <input
                  type="checkbox"
                  checked={chosen.has(p.id)}
                  onChange={(e) => {
                    const n = new Set(chosen);
                    if (e.target.checked) n.add(p.id);
                    else n.delete(p.id);
                    setChosen(n);
                  }}
                />
                {p.name}
              </label>
            ))}
            {/* Removed from the organization: shown so the admin can take them off (2026-11-28). */}
            {(editing && editing !== 'new' && people.data
              ? editing.members.filter(
                  (x) =>
                    x.removed || !new Set((people.data?.items ?? []).map((p) => p.id)).has(x.id),
                )
              : []
            )
              .filter((x) => x.id !== me?.id)
              .map((x) => (
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
            <button className="btn" disabled={!name.trim() || !chosen.size} onClick={save}>
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
