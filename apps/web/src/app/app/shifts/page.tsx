'use client';

import { useEffect, useState } from 'react';
import { Empty, ErrorBox, Flag, Loading, PageHead } from '../../../components/ui';
import {
  type ApiError,
  formatDate,
  formatMinutes,
  formatTime,
  post,
  put,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';

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

export default function ShiftsPage() {
  const { actor } = useSession();
  const admin = actor === 'org_admin';
  const [week, setWeek] = useState(mondayOf(today()));
  const to = addDays(week, 6);
  const { data, error, loading, reload } = useApi<Dash>(
    `${admin ? '/dashboard/shifts' : '/dashboard/me'}?from=${week}&to=${to}`,
    60_000,
  );
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const now = today();
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(max-width: 760px)');
    const on = () => setIsPhone(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  // On a phone the calendar shows today only (decision 2026-11-14).
  const shown = isPhone
    ? days.filter((d) => d === now).concat(days.includes(now) ? [] : [days[0] as string])
    : days;

  return (
    <div className="page wide">
      <PageHead title="Shifts" sub={`${formatDate(week)} – ${formatDate(to)}`}>
        <div className="row">
          <button className="btn ghost" onClick={() => setWeek(addDays(week, -7))}>
            Previous week
          </button>
          <button className="btn ghost" onClick={() => setWeek(mondayOf(today()))}>
            This week
          </button>
          <button className="btn ghost" onClick={() => setWeek(addDays(week, 7))}>
            Next week
          </button>
        </div>
      </PageHead>
      {admin ? <PunchRequests /> : null}
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.employees.length ? <Empty>No employees yet.</Empty> : null}
      {data?.employees.length ? (
        <div className="scroll">
          <div
            className="cal"
            style={{
              gridTemplateColumns: `minmax(130px, 170px) repeat(${shown.length}, minmax(0, 1fr))`,
            }}
          >
            <div className="h">Employee</div>
            {shown.map((d) => (
              <div
                key={d}
                className="h"
                style={d === now ? { color: 'var(--primary)' } : undefined}
              >
                {formatDate(d)}
                {d === now ? ' · Today' : ''}
              </div>
            ))}
            {data.employees.map((e) => (
              <Row
                key={e.employee.id}
                name={e.employee.name}
                color={COLORS[e.color % COLORS.length] as string}
                days={e.days}
                shown={shown}
              />
            ))}
          </div>
        </div>
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
}: {
  name: string;
  color: string;
  days: Day[];
  shown: string[];
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
        if (!d || (!d.planned && !d.sessions.length)) return <div key={date} />;
        return (
          <div key={date}>
            <div className={flagged ? 'blk red' : 'blk'} style={{ background: color }}>
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
                <Flag key={f.code}>{f.message}</Flag>
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
      <h2>Punch corrections waiting</h2>
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
              Approve
            </button>
            <button className="btn ghost" onClick={() => decide(r.id, 'reject')}>
              Reject
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
      <h2>Weekly plan</h2>
      <ErrorBox error={error ?? err} />
      <select
        className="input"
        value={who}
        onChange={(e) => setWho(e.target.value)}
        aria-label="Employee"
      >
        <option value="">Choose an employee</option>
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
                  {WEEKDAYS[wd]}
                </label>
                <input
                  className="input"
                  type="time"
                  disabled={!r.on}
                  value={r.start}
                  onChange={(e) => setRows({ ...rows, [wd]: { ...r, start: e.target.value } })}
                  aria-label={`${WEEKDAYS[wd]} start`}
                />
                <input
                  className="input"
                  type="time"
                  disabled={!r.on}
                  value={r.end}
                  onChange={(e) => setRows({ ...rows, [wd]: { ...r, end: e.target.value } })}
                  aria-label={`${WEEKDAYS[wd]} end`}
                />
                {night ? <span className="pill blue">Ends next day</span> : null}
              </div>
            );
          })}
          <div className="row">
            <button className="btn" onClick={save}>
              Save plan
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
      setMsg('Sent to your admin.');
      setReason('');
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <section className="card">
      <h2>Ask for a correction</h2>
      <p className="muted small">
        Forgot to punch? Tell your admin the real times. Nothing changes until they approve.
      </p>
      <ErrorBox error={err} />
      <div className="row wrap">
        <input
          className="input"
          type="date"
          value={date}
          max={today()}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Shift date"
        />
        <input
          className="input"
          type="time"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          aria-label="Start"
        />
        <input
          className="input"
          type="time"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          aria-label="End"
        />
      </div>
      <label className="field">
        Reason
        <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn" disabled={!reason.trim()} onClick={send}>
          Send
        </button>
        {msg ? <span className="pill ok">{msg}</span> : null}
      </div>
    </section>
  );
}
