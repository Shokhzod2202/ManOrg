'use client';

import { useState } from 'react';
import { formatDate, formatMinutes, type Schemas, today } from '../../lib/api';
import { getLocale, INTL, t } from '../../lib/i18n';
import { useApi } from '../../lib/use-api';
import { Empty, ErrorBox, Loading } from '../ui';

export const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

export const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};

/** Expected time ÷ time worked (cleaning left out): 100% is the expected pace. */
export function pace(expected: number, worked: number, cleaningHours: number): number | null {
  const making = worked - cleaningHours * 60;
  return making > 0 && expected > 0 ? Math.round((expected / making) * 100) : null;
}

/**
 * Decided 2026-11-28: one employee's output day by day for a month, newest first: what they made
 * (personal and their share of team work), hours worked (punch cards, finished shifts), expected
 * time, pace, pieces per hour and cleaning, with the month's totals on top.
 */
export function EmployeeDays({
  employeeId,
  onBack,
  title,
}: {
  employeeId: string;
  /** Leave out on the person's own page (decided 2026-11-28: Output history). */
  onBack?: () => void;
  title?: string;
}) {
  const [month, setMonth] = useState(today().slice(0, 7));
  // Decided 2026-11-28: search the month's days by product.
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
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
  const matches = (name: string) => !query || name.toLowerCase().includes(query);
  const shown = query
    ? days
        .map((d) => ({
          ...d,
          personal: d.personal.filter((l) => matches(l.name)),
          team: d.team.filter((l) => matches(l.name)),
        }))
        .filter((d) => d.personal.length || d.team.length)
    : days;
  const found = shown.reduce(
    (n, d) =>
      n +
      d.personal.reduce((m, l) => m + l.quantity, 0) +
      d.team.reduce((m, l) => m + l.creditedQuantity, 0),
    0,
  );
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
        {onBack ? (
          <button type="button" className="btn ghost small-btn" onClick={onBack}>
            ← {t('All employees')}
          </button>
        ) : null}
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
            <h2>{title ?? out.data.employee.name}</h2>
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
          <input
            className="input"
            type="search"
            placeholder={t('Search products')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('Search products')}
          />
          {query ? (
            <span className="muted small" data-testid="search-found">
              {t('{n} pieces on {d} days', {
                n: Math.round(found * 10) / 10,
                d: shown.length,
              })}
            </span>
          ) : null}
          {!days.length ? <Empty>{t('No output this month.')}</Empty> : null}
          {days.length && !shown.length ? <Empty>{t('No product matches.')}</Empty> : null}
          {shown.map((d) => {
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
          {/* Scroll on into the month before. */}
          <button
            type="button"
            className="btn ghost"
            style={{ alignSelf: 'center' }}
            onClick={() => {
              setMonth(shiftMonth(month, -1));
              window.scrollTo({ top: 0 });
            }}
          >
            ‹ {monthLabel(shiftMonth(month, -1))}
          </button>
        </>
      ) : null}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="stat">
      <span className="muted small">{label}</span>
      <b>{value}</b>
    </span>
  );
}

export const monthLabel = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(INTL[getLocale()], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
