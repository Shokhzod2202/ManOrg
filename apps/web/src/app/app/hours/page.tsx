'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { confirmAction } from '../../../components/confirm';
import { won } from '../../../components/orders/value';
import { Empty, ErrorBox, Icon, Loading, PageHead } from '../../../components/ui';
import {
  type ApiError,
  formatDate,
  formatMinutes,
  formatTime,
  post,
  put,
  type Schemas,
} from '../../../lib/api';
import { getLocale, INTL, t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';
import { refreshApi, useApi } from '../../../lib/use-api';

type Month = Schemas['WorkHoursMonth'];
type Person = Month['people'][number];
type Advance = Schemas['SalaryAdvance'];

/** The organization's local date of an instant, as YYYY-MM-DD. */
const localDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString(INTL[getLocale()], {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Decided 2026-11-30: each person's finished hours from their punch card, per day and for the
 * month, never from the shift plan; and the advances ("avans") admins logged that month.
 */
export default function HoursPage() {
  const { actor, membership } = useSession();
  const admin = actor === 'org_admin';
  // Decided 2026-11-26: hourly cost is for owners only.
  const owner = admin && membership?.owner === true;
  const [month, setMonth] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Month>(
    month ? `/work-hours?month=${month}` : '/work-hours',
  );
  const shown = month ?? data?.month ?? null;
  const current = data?.today.slice(0, 7);

  return (
    <div className="page">
      <PageHead
        title={t('Work hours')}
        sub={t(
          'From punch cards only. A shift counts once ended, on the day it started; pauses are not counted.',
        )}
      />
      <div className="viewbar">
        <div className="month-switch">
          <button
            className="btn ghost"
            aria-label={t('Previous month')}
            disabled={!shown}
            onClick={() => shown && setMonth(shiftMonth(shown, -1))}
          >
            ‹
          </button>
          <b>{shown ? monthName(shown) : '…'}</b>
          <button
            className="btn ghost"
            aria-label={t('Next month')}
            disabled={!shown || shown === current}
            onClick={() => shown && setMonth(shiftMonth(shown, 1))}
          >
            ›
          </button>
        </div>
        {data && !loading ? (
          <span className="muted">
            {admin
              ? t('{n} people · {hours} worked · {advances} in advances', {
                  n: data.people.length,
                  hours: formatMinutes(data.totals.minutes),
                  advances: won(data.totals.advances),
                })
              : null}
          </span>
        ) : null}
      </div>
      {loading ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !loading && !data.people.length ? (
        <Empty>{t('Nobody works shifts here yet.')}</Empty>
      ) : null}
      {data && !loading
        ? data.people.map((p) => (
            <PersonHours
              key={p.employee.id}
              person={p}
              month={data}
              admin={admin}
              owner={owner}
              open={!admin}
              onChanged={reload}
            />
          ))
        : null}
    </div>
  );
}

function PersonHours({
  person: p,
  month,
  admin,
  owner,
  open,
  onChanged,
}: {
  person: Person;
  month: Month;
  admin: boolean;
  owner: boolean;
  open: boolean;
  onChanged: () => void;
}) {
  return (
    <details className="card hours-person" open={open}>
      <summary>
        <span className="hours-name">
          <b>{p.employee.name}</b>
          {p.employee.title ? <span className="muted small"> · {p.employee.title}</span> : null}
          {p.removedOn ? (
            <span className="muted small">
              {' '}
              {t('(removed {date})', { date: formatDate(p.removedOn) })}
            </span>
          ) : null}
        </span>
        <span className="hours-figures">
          <span>
            <b data-testid="hours-total">{formatMinutes(p.minutes)}</b>
            <span className="muted small">
              {' '}
              · {p.daysWorked === 1 ? t('1 day') : t('{n} days', { n: p.daysWorked })}
            </span>
          </span>
          <span className={p.advances.total ? 'pill warn' : 'pill'}>
            {t('Avans')} {won(p.advances.total)}
          </span>
          {p.unfinished ? (
            <span className="pill" title={t('Counted once the shift is ended.')}>
              {t('{n} not ended', { n: p.unfinished })}
            </span>
          ) : null}
          <Icon name="chevron" size={16} />
        </span>
      </summary>
      <div className="grid2" style={{ alignItems: 'start' }}>
        <div>
          <h3 className="hours-h">{t('Days worked')}</h3>
          {p.days.length ? (
            <table className="t">
              <tbody>
                {p.days.map((d) => (
                  <tr key={d.date}>
                    <td>{formatDate(d.date)}</td>
                    <td className="muted small">
                      {d.shifts > 1 ? t('{n} shifts', { n: d.shifts }) : ''}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <b>{formatMinutes(d.minutes)}</b>
                    </td>
                  </tr>
                ))}
                <tr className="sum">
                  <td colSpan={2}>{t('Month total')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <b>{formatMinutes(p.minutes)}</b>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="muted small">{t('No finished shifts this month.')}</p>
          )}
          {/* Decided 2026-11-26: when each shift that has not ended started. */}
          {p.openSince.length ? (
            <div className="open-shifts">
              {p.openSince.map((at) => (
                <span key={at} className="hint-bad">
                  {t('Not ended: started {date} {time}. It counts once ended.', {
                    date: formatDate(localDay(at, month.timezone)),
                    time: formatTime(at, month.timezone),
                  })}
                </span>
              ))}
              {admin ? (
                <Link className="small" href="/app/shifts">
                  {t('Fix in Shifts')}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
        {owner ? <OwnerRate person={p} onChanged={onChanged} /> : null}
        <Advances person={p} month={month} admin={admin} onChanged={onChanged} />
      </div>
    </details>
  );
}

function Advances({
  person: p,
  month,
  admin,
  onChanged,
}: {
  person: Person;
  month: Month;
  admin: boolean;
  onChanged: () => void;
}) {
  const inMonth = month.today >= month.from && month.today <= month.to;
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(inMonth ? month.today : month.to);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const name = p.employee.name;

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (!value) return;
    const ok = await confirmAction(
      t('Log {amount} avans for {name} on {date}?', {
        amount: won(value),
        name,
        date: formatDate(paidOn),
      }),
      { confirmLabel: t('Log avans') },
    );
    if (!ok) return;
    setErr(null);
    setBusy(true);
    try {
      await post('/salary-advances', {
        employeeId: p.employee.id,
        amount: value,
        paidOn,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setAmount('');
      setNote('');
      onChanged();
      refreshApi('/work-hours');
    } catch (x) {
      setErr(x as ApiError);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(a: Advance) {
    const ok = await confirmAction(
      t('Cancel the {amount} avans of {date}?', {
        amount: won(a.amount),
        date: formatDate(a.paidOn),
      }),
      {
        detail: t('It stays listed as cancelled and no longer counts.'),
        confirmLabel: t('Cancel avans'),
        danger: true,
      },
    );
    if (!ok) return;
    setErr(null);
    try {
      await post(`/salary-advances/${a.id}/cancel`, {});
      onChanged();
    } catch (x) {
      setErr(x as ApiError);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 className="hours-h">{t('Avans (advances paid)')}</h3>
      <ErrorBox error={err} />
      {p.advances.items.length ? (
        <table className="t">
          <tbody>
            {p.advances.items.map((a) => (
              <tr key={a.id} className={a.cancelledAt ? 'cancelled' : ''}>
                <td>
                  {formatDate(a.paidOn)}
                  {a.note ? <span className="muted small"> · {a.note}</span> : null}
                  {a.cancelledAt ? <span className="muted small"> · {t('cancelled')}</span> : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {a.cancelledAt ? <s>{won(a.amount)}</s> : <b>{won(a.amount)}</b>}
                </td>
                {admin ? (
                  <td style={{ width: 1 }}>
                    {!a.cancelledAt ? (
                      <button
                        className="btn ghost small-btn"
                        aria-label={t('Cancel the {amount} avans of {date}', {
                          amount: won(a.amount),
                          date: formatDate(a.paidOn),
                        })}
                        onClick={() => void cancel(a)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
            <tr className="sum">
              <td>{t('Month total')}</td>
              <td style={{ textAlign: 'right' }}>
                <b>{won(p.advances.total)}</b>
              </td>
              {admin ? <td /> : null}
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="muted small">{t('No avans this month.')}</p>
      )}
      {admin ? (
        <form className="avans-form" onSubmit={add}>
          <input
            className="input"
            type="number"
            min={1}
            inputMode="numeric"
            placeholder={t('Amount (₩)')}
            aria-label={t('Avans amount for {name}', { name })}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <input
            className="input"
            type="date"
            value={paidOn}
            max={month.today}
            onChange={(e) => setPaidOn(e.target.value)}
            aria-label={t('Day the money was sent')}
            required
          />
          <input
            className="input"
            placeholder={t('Note (optional)')}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={t('Note')}
          />
          <button className="btn" disabled={busy || !Number(amount)}>
            {t('Log avans')}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Decided 2026-11-26: what one hour of this person's work costs, set and seen by owners only.
 * It applies from now on; Output uses it for each employee's efficiency.
 */
function OwnerRate({ person: p, onChanged }: { person: Person; onChanged: () => void }) {
  const [value, setValue] = useState(p.hourlyRate != null ? String(p.hourlyRate) : '');
  const [err, setErr] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaved(false);
    try {
      await put(`/employees/${p.employee.id}/hourly-rate`, {
        hourlyRate: Math.round(Number(value)),
      });
      setSaved(true);
      onChanged();
    } catch (x) {
      setErr(x as ApiError);
    }
  }
  return (
    <form className="stack owner-rate" style={{ gap: 6 }} onSubmit={save}>
      <h3 className="hours-h">{t('Hourly cost')}</h3>
      <span className="muted small">{t('Only owners see this.')}</span>
      <ErrorBox error={err} />
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          placeholder={t('Won per hour')}
          aria-label={t('Hourly cost of {name}', { name: p.employee.name })}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ minWidth: 0 }}
        />
        <button className="btn" disabled={!value.trim() || Number(value) === p.hourlyRate}>
          {t('Save')}
        </button>
      </div>
      {p.laborCost != null ? (
        <span className="small">
          {t('This month: {amount} for {hours}', {
            amount: won(p.laborCost),
            hours: formatMinutes(p.minutes),
          })}
        </span>
      ) : null}
      {saved ? <span className="pill ok">{t('Saved. It applies from now on.')}</span> : null}
    </form>
  );
}
