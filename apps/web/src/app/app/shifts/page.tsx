'use client';

import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Flag, Loading, PageHead } from '../../../components/ui';
import {
  type ApiError,
  formatDate,
  formatMinutes,
  formatTime,
  patch,
  post,
  put,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { flagText, t } from '../../../lib/i18n';

type Dash = Schemas['ShiftDashboard'];
type Day = Schemas['TimesheetDay'];
type Plan = Schemas['ShiftPlan'];
type ChangeReq = Schemas['PunchChangeRequest'];

/** People colours (never red, which is kept for flags). */
const COLORS = [
  '#e3ecfb',
  '#e5f4ea',
  '#fdf0d9',
  '#efe6fa',
  '#dff3f5',
  '#fbe7f0',
  '#eceff3',
  '#f3f0dc',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(iso: string) {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, wd === 0 ? -6 : 1 - wd);
}

type Span = 'day' | 'week' | 'month';

function rangeOf(span: Span, anchor: string): { from: string; to: string } {
  if (span === 'day') return { from: anchor, to: anchor };
  if (span === 'week') {
    const from = mondayOf(anchor);
    return { from, to: addDays(from, 6) };
  }
  const from = `${anchor.slice(0, 7)}-01`;
  const next = new Date(`${from}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: addDays(next.toISOString().slice(0, 10), -1) };
}

function move(span: Span, anchor: string, step: number): string {
  if (span === 'day') return addDays(anchor, step);
  if (span === 'week') return addDays(anchor, 7 * step);
  const d = new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + step);
  return d.toISOString().slice(0, 10);
}

/** SHF-2, SHF-6 to SHF-8: calendar by day, week or month, one colour per person, red for differences. */
export default function ShiftsPage() {
  const { actor } = useSession();
  const admin = actor === 'org_admin';
  const [span, setSpan] = useState<Span>('week');
  const [anchor, setAnchor] = useState(today());
  const [isPhone, setIsPhone] = useState(false);
  const [pick, setPick] = useState<{ employeeId: string; date: string } | null>(null);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 760px)');
    const on = () => setIsPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  // On a phone the calendar opens on one day (decision 2026-11-14); week and month stay available.
  useEffect(() => {
    if (isPhone) setSpan('day');
  }, [isPhone]);
  const { from, to } = rangeOf(span, anchor);
  const { data, error, loading, reload } = useApi<Dash>(
    `${admin ? '/dashboard/shifts' : '/dashboard/me'}?from=${from}&to=${to}`,
    60_000,
  );
  const shown: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) shown.push(d);
  const now = today();
  const compact = span === 'month';

  return (
    <div className="page wide">
      <PageHead
        title={t('Shifts')}
        sub={from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`}
      >
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <div className="tabs" role="tablist" aria-label={t('Calendar range')}>
            {(['day', 'week', 'month'] as Span[]).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={span === v}
                className={span === v ? 'on' : ''}
                onClick={() => setSpan(v)}
              >
                {t(v[0]!.toUpperCase() + v.slice(1))}
              </button>
            ))}
          </div>
          <button
            className="btn ghost"
            onClick={() => setAnchor(move(span, anchor, -1))}
            aria-label={t('Previous')}
          >
            ‹
          </button>
          <button className="btn ghost" onClick={() => setAnchor(today())}>
            {t('Today')}
          </button>
          <button
            className="btn ghost"
            onClick={() => setAnchor(move(span, anchor, 1))}
            aria-label={t('Next')}
          >
            ›
          </button>
        </div>
      </PageHead>
      {admin ? <PunchRequests /> : null}
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.employees.length ? <Empty>{t('No employees yet.')}</Empty> : null}
      {data?.employees.length ? (
        <div className="scroll">
          <div
            className="cal"
            style={{
              gridTemplateColumns: `minmax(120px, 170px) repeat(${shown.length}, ${compact ? 'minmax(52px, 1fr)' : 'minmax(0, 1fr)'})`,
              minWidth: compact ? 120 + shown.length * 52 : undefined,
            }}
          >
            <div className="h">{t('Employee')}</div>
            {shown.map((d) => (
              <div
                key={d}
                className="h"
                style={d === now ? { color: 'var(--primary)' } : undefined}
              >
                {compact ? Number(d.slice(8)) : formatDate(d)}
                {!compact && d === now ? ' · Today' : ''}
              </div>
            ))}
            {data.employees.map((e) => (
              <Row
                key={e.employee.id}
                name={e.employee.name}
                color={COLORS[e.color % COLORS.length] as string}
                days={e.days}
                shown={shown}
                compact={compact}
                onPick={
                  admin
                    ? (date) => {
                        setPick({ employeeId: e.employee.id, date });
                        document
                          .getElementById('punch-editor')
                          ?.scrollIntoView({ behavior: 'smooth' });
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ) : null}
      {admin ? (
        <PunchEditor
          employees={data?.employees.map((e) => e.employee) ?? []}
          pick={pick}
          onChange={reload}
        />
      ) : null}
      {admin ? <PlanEditor /> : <MyChangeRequest />}
    </div>
  );
}

function Row({
  name,
  color,
  days,
  shown,
  compact,
  onPick,
}: {
  name: string;
  color: string;
  days: Day[];
  shown: string[];
  compact: boolean;
  onPick?: (date: string) => void;
}) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  return (
    <>
      <div>
        <b>{name}</b>
      </div>
      {shown.map((date) => {
        const d = byDate.get(date);
        const s = d?.sessions[0];
        const flagged = Boolean(d?.flags.length);
        if (!d || (!d.planned && !d.sessions.length))
          return (
            <div key={date}>
              {onPick ? (
                <button type="button" className="sr" onClick={() => onPick(date)}>
                  {t('Add a punch for {name} on {date}', { name, date })}
                </button>
              ) : null}
            </div>
          );
        if (compact)
          return (
            <div key={date} style={{ padding: 3 }}>
              <button
                type="button"
                className={flagged ? 'blk red' : 'blk'}
                style={{
                  background: color,
                  border: 'none',
                  width: '100%',
                  cursor: onPick ? 'pointer' : 'default',
                  font: 'inherit',
                }}
                onClick={onPick ? () => onPick(date) : undefined}
                title={d.flags.map((f) => f.message).join(' ')}
              >
                <b>{d.workedMinutes ? `${Math.round(d.workedMinutes / 6) / 10} h` : '—'}</b>
                {flagged ? <Flag>{d.flags.length}</Flag> : null}
              </button>
            </div>
          );
        return (
          <div key={date}>
            <div
              className={flagged ? 'blk red' : 'blk'}
              style={{ background: color, cursor: onPick ? 'pointer' : undefined }}
              onClick={onPick ? () => onPick(date) : undefined}
              role={onPick ? 'button' : undefined}
              tabIndex={onPick ? 0 : undefined}
              onKeyDown={
                onPick
                  ? (e) => {
                      if (e.key === 'Enter') onPick(date);
                    }
                  : undefined
              }
            >
              {d.planned ? (
                <span>
                  Plan {d.planned.startTime}–{d.planned.endTime}
                  {d.planned.endDate !== d.planned.startDate
                    ? ` (ends ${formatDate(d.planned.endDate)})`
                    : ''}
                </span>
              ) : null}
              {s ? (
                <b>
                  {formatTime(s.startedAt)}–
                  {s.endedAt ? formatTime(s.endedAt) : s.status === 'ended' ? '?' : 'now'}
                </b>
              ) : null}
              {d.workedMinutes ? <span>{formatMinutes(d.workedMinutes)}</span> : null}
              {d.flags.map((f) => (
                <Flag key={f.code}>{flagText(f)}</Flag>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

/** SHF-5: approve or reject an employee's correction request. */
function PunchRequests() {
  const { data, reload } = useApi<{ items: ChangeReq[] }>(
    '/punch-change-requests?status=pending',
    60_000,
  );
  const [err, setErr] = useState<ApiError | null>(null);
  if (!data?.items.length) return null;
  async function decide(id: string, decision: 'approve' | 'reject') {
    setErr(null);
    try {
      await post(`/punch-change-requests/${id}/decision`, { decision });
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>{t('Punch corrections waiting')}</h2>
      <ErrorBox error={err} />
      {data.items.map((r) => (
        <div key={r.id} className="row between wrap">
          <span>
            <b>{r.employee.name}</b> · {formatDate(r.shiftDate)}: {formatTime(r.original.start)}–
            {formatTime(r.original.end) || '?'} →{' '}
            <b>
              {formatTime(r.requested.start)}–{formatTime(r.requested.end)}
            </b>
            {r.reason ? <span className="muted small"> · “{r.reason}”</span> : null}
          </span>
          <span className="row">
            <button className="btn" onClick={() => decide(r.id, 'approve')}>
              {t('Approve')}
            </button>
            <button className="btn ghost" onClick={() => decide(r.id, 'reject')}>
              {t('Reject')}
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

/** SHF-1: weekly plan per employee; an end time before the start ends on the next day. */
function PlanEditor() {
  const { data, error, reload } = useApi<{ items: Plan[] }>('/shifts');
  const [who, setWho] = useState<string>('');
  const [rows, setRows] = useState<Record<number, { on: boolean; start: string; end: string }>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  useEffect(() => {
    const plan = data?.items.find((p) => p.employee.id === who);
    setRows(
      Object.fromEntries(
        Array.from({ length: 7 }, (_, wd) => {
          const d = plan?.days.find((x) => x.weekday === wd);
          return [
            wd,
            { on: Boolean(d), start: d?.startTime ?? '08:00', end: d?.endTime ?? '17:00' },
          ];
        }),
      ),
    );
  }, [who, data]);

  async function save() {
    setErr(null);
    setMsg(null);
    try {
      const days = Object.entries(rows)
        .filter(([, r]) => r.on)
        .map(([wd, r]) => ({ weekday: Number(wd), startTime: r.start, endTime: r.end }));
      await put('/shifts', { employeeId: who, days });
      setMsg('Saved.');
      reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <section className="card">
      <h2>{t('Weekly plan')}</h2>
      <ErrorBox error={error ?? err} />
      <select
        className="input"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label={t('Employee')}
      >
        <option value="">{t('Choose an employee')}</option>
        {data?.items.map((p) => (
          <option key={p.employee.id} value={p.employee.id}>
            {p.employee.name}
          </option>
        ))}
      </select>
      {who ? (
        <>
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
            const r = rows[wd];
            if (!r) return null;
            const night = r.on && r.end <= r.start;
            return (
              <div key={wd} className="row wrap">
                <label className="row" style={{ width: 90 }}>
                  <input
                    type="checkbox"
                    checked={r.on}
                    onChange={(e) => setRows({ ...rows, [wd]: { ...r, on: e.target.checked } })}
                  />
                  {t(WEEKDAYS[wd])}
                </label>
                <input
                  className="input"
                  type="time"
                  disabled={!r.on}
                  value={r.start}
                  onChange={(e) => setRows({ ...rows, [wd]: { ...r, start: e.target.value } })}
                  aria-label={`${t(WEEKDAYS[wd])} start`}
                />
                <input
                  className="input"
                  type="time"
                  disabled={!r.on}
                  value={r.end}
                  onChange={(e) => setRows({ ...rows, [wd]: { ...r, end: e.target.value } })}
                  aria-label={`${t(WEEKDAYS[wd])} end`}
                />
                {night ? <span className="pill blue">{t('Ends next day')}</span> : null}
              </div>
            );
          })}
          <div className="row">
            <button className="btn" onClick={save}>
              {t('Save plan')}
            </button>
            {msg ? <span className="pill ok">{msg}</span> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** SHF-5: an employee asks the admin to correct a shift. */
function MyChangeRequest() {
  const [date, setDate] = useState(today());
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('17:00');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);

  async function send() {
    setErr(null);
    setMsg(null);
    try {
      const endDate = end <= start ? addDays(date, 1) : date;
      // Times are the organization's (Seoul, UTC+9, no daylight saving).
      await post('/punch-change-requests', {
        shiftDate: date,
        requestedStart: new Date(`${date}T${start}:00+09:00`).toISOString(),
        requestedEnd: new Date(`${endDate}T${end}:00+09:00`).toISOString(),
        reason: reason.trim(),
      });
      setMsg(t('Sent to your admin.'));
      setReason('');
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>{t('Ask for a correction')}</h2>
      <p className="muted small">
        {t('Forgot to punch? Tell your admin the real times. Nothing changes until they approve.')}
      </p>
      <ErrorBox error={err} />
      <div className="row wrap">
        <input
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Shift date')}
        />
        <input
          className="input"
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-label={t('Start')}
        />
        <input
          className="input"
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          aria-label={t('End')}
        />
      </div>
      <label className="field">
        {t('Reason')}
        <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn" disabled={!reason.trim()} onClick={send}>
          {t('Send')}
        </button>
        {msg ? <span className="pill ok">{msg}</span> : null}
      </div>
    </section>
  );
}

/** Times are entered in the organization's time zone (Seoul, UTC+9, no daylight saving). */
const toLocal = (iso: string) =>
  new Date(new Date(iso).getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
const fromLocal = (v: string) => new Date(`${v}:00+09:00`).toISOString();

/** SHF-4: the admin corrects or adds punches; every change is audited and shown to the employee. */
function PunchEditor({
  employees,
  pick,
  onChange,
}: {
  employees: { id: string; name: string }[];
  pick: { employeeId: string; date: string } | null;
  onChange: () => void;
}) {
  const [who, setWho] = useState('');
  const [date, setDate] = useState(today());
  useEffect(() => {
    if (pick) {
      setWho(pick.employeeId);
      setDate(pick.date);
    }
  }, [pick]);
  const sheet = useApi<Schemas['Timesheet']>(
    who ? `/punch?from=${date}&to=${date}&employee_id=${who}` : null,
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [type, setType] = useState<'start' | 'pause' | 'end'>('start');
  const [at, setAt] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const events = (sheet.data?.days ?? []).flatMap((d) => d.sessions.flatMap((x) => x.events));

  async function run(fn: () => Promise<unknown>, done: string) {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(t(done));
      setEdits({});
      sheet.reload();
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  const label = { start: 'Start', pause: 'Pause', end: 'End' } as const;
  return (
    <section className="card" id="punch-editor">
      <h2>{t('Punch card editor')}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t(
          'Click a day in the calendar, or choose a person and date. Changes are recorded with the old and new time.',
        )}
      </p>
      <div className="row wrap">
        <select
          className="input"
          value={who}
          onChange={(e) => setWho(e.target.value)}
          aria-label={t('Employee')}
        >
          <option value="">{t('Choose an employee')}</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Shift date')}
        />
      </div>
      <ErrorBox error={sheet.error ?? err} />
      {msg ? <span className="pill ok">{msg}</span> : null}
      {who && sheet.data ? (
        <>
          {!events.length ? <Empty>{t('No punches on this day.')}</Empty> : null}
          {events.map((ev) => (
            <div key={ev.id} className="row wrap">
              <span className="pill" style={{ width: 64, justifyContent: 'center' }}>
                {t(label[ev.eventType])}
              </span>
              <input
                className="input"
                type="datetime-local"
                value={edits[ev.id] ?? toLocal(ev.occurredAt)}
                onChange={(e) => setEdits({ ...edits, [ev.id]: e.target.value })}
                aria-label={t('{what} time', { what: t(label[ev.eventType]) })}
              />
              {edits[ev.id] ? (
                <button
                  className="btn"
                  onClick={() =>
                    run(
                      () =>
                        patch(
                          `/punch/${ev.id}`,
                          { occurredAt: fromLocal(edits[ev.id]!) },
                          { ifMatch: ev.version ?? 0 },
                        ),
                      'Punch corrected.',
                    )
                  }
                >
                  {t('Save')}
                </button>
              ) : null}
              <span className="muted small">
                {ev.source === 'admin' ? t('Edited by an admin') : ''}
              </span>
            </div>
          ))}
          <div
            className="row wrap"
            style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}
          >
            <b>{t('Add a missing punch')}</b>
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
              aria-label={t('Punch type')}
            >
              <option value="start">{t('Start')}</option>
              <option value="pause">{t('Pause')}</option>
              <option value="end">{t('End')}</option>
            </select>
            <input
              className="input"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              aria-label={t('Punch time')}
            />
            <button
              className="btn ghost"
              disabled={!at}
              onClick={() =>
                run(
                  () =>
                    post('/punch-events', {
                      employeeId: who,
                      eventType: type,
                      occurredAt: fromLocal(at),
                    }),
                  'Punch added.',
                )
              }
            >
              {t('Add')}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
