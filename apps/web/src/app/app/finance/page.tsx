'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { api, type ApiError, formatDate, post, put, type Schemas, today } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Summary = Schemas['FinanceSummary'];
type FDelivery = Schemas['FinanceDelivery'] & { contractor?: { id: string; name: string } };
type Payment = Schemas['Payment'];
type Period = Schemas['SettlementPeriod'] & { contractor?: { id: string; name: string } };
type Event = Schemas['FinanceEvent'] & { contractor?: { id: string; name: string } };

const won = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `₩${n.toLocaleString('en-US')}`;
const monthStart = () => `${today().slice(0, 8)}01`;
const PAY_STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: 'Waiting for review', cls: 'pill warn' },
  approved: { text: 'Approved', cls: 'pill ok' },
  rejected: { text: 'Not approved', cls: 'pill' },
  cancelled: { text: 'Withdrawn', cls: 'pill' },
  reversed: { text: 'Reversed', cls: 'pill' },
};

/** F-001: delivery-based money for the bakery admin and the contractor admin. */
export default function FinancePage() {
  const { actor } = useSession();
  if (actor === 'contractor_admin') return <ContractorFinance />;
  if (actor === 'org_admin') return <AdminFinance />;
  return (
    <div className="page">
      <PageHead title={t('Finance')} />
      <Empty>{t('Finance is for admins.')}</Empty>
    </div>
  );
}

function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([k, label]) => (
        <button
          key={k}
          role="tab"
          aria-selected={value === k}
          className={value === k ? 'on' : ''}
          onClick={() => onChange(k)}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}

function Range({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="row wrap" style={{ justifyContent: 'center' }}>
      <input
        className="input"
        type="date"
        value={from}
        max={to}
        onChange={(e) => onChange(e.target.value, to)}
        aria-label={t('From')}
      />
      <span className="muted">{t('to')}</span>
      <input
        className="input"
        type="date"
        value={to}
        min={from}
        onChange={(e) => onChange(from, e.target.value)}
        aria-label={t('To')}
      />
    </div>
  );
}

function Cards({
  s,
}: {
  s: {
    deliveredValue: number;
    approvedPayments: number;
    pendingPayments: number;
    outstanding: number;
  };
}) {
  return (
    <div className="kpis">
      <div className="kpi">
        <b>{won(s.deliveredValue)}</b>
        <span>{t('Delivered in the period')}</span>
      </div>
      <div className="kpi">
        <b>{won(s.approvedPayments)}</b>
        <span>{t('Payments approved')}</span>
      </div>
      <div className="kpi">
        <b>{won(s.pendingPayments)}</b>
        <span>{t('Waiting for review (not counted yet)')}</span>
      </div>
      <div className="kpi">
        <b style={{ color: s.outstanding > 0 ? 'var(--ink)' : 'var(--ok)' }}>
          {won(s.outstanding)}
        </b>
        <span>{t('Outstanding now')}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bakery admin

function AdminFinance() {
  const [tab, setTab] = useState<'overview' | 'payments' | 'deliveries' | 'settlement'>('overview');
  const [contractor, setContractor] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today('Asia/Seoul', 30));
  const summary = useApi<Summary>(`/finance/summary?from=${from}&to=${to}`);
  const contractors = summary.data?.contractors ?? [];
  const q = contractor ? `contractor_id=${contractor}&` : '';

  return (
    <div className="page wide">
      <PageHead
        title={t('Finance')}
        sub={t('Values come from delivered quantities; only approved payments change a balance.')}
      >
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            ['overview', 'Overview'],
            ['payments', 'Payments'],
            ['deliveries', 'Deliveries'],
            ['settlement', 'Settlement'],
          ]}
        />
      </PageHead>
      <div className="viewbar">
        <select
          className="input"
          value={contractor}
          onChange={(e) => setContractor(e.target.value)}
          aria-label={t('Contractor')}
        >
          <option value="">{t('All contractors')}</option>
          {contractors.map((c) => (
            <option key={c.contractor.id} value={c.contractor.id}>
              {c.contractor.name}
            </option>
          ))}
        </select>
        {tab === 'overview' || tab === 'deliveries' ? (
          <Range
            from={from}
            to={to}
            onChange={(a, b) => {
              setFrom(a);
              setTo(b);
            }}
          />
        ) : null}
      </div>
      {tab === 'overview' ? (
        <>
          {summary.loading && !summary.data ? <Loading /> : null}
          <ErrorBox error={summary.error} onRetry={summary.reload} />
          {summary.data ? (
            <>
              <Cards
                s={
                  contractor
                    ? (contractors.find((c) => c.contractor.id === contractor) ??
                      summary.data.totals)
                    : summary.data.totals
                }
              />
              {!contractors.length ? <Empty>{t('No approved contractors yet.')}</Empty> : null}
              {contractors.length ? (
                <table className="t cards">
                  <thead>
                    <tr>
                      <th>{t('Contractor')}</th>
                      <th>{t('Delivered')}</th>
                      <th>{t('Approved')}</th>
                      <th>{t('Waiting')}</th>
                      <th>{t('Outstanding')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contractors.map((c) => (
                      <tr
                        key={c.contractor.id}
                        onClick={() => setContractor(c.contractor.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td data-label={t('Contractor')}>
                          <b>{c.contractor.name}</b>
                        </td>
                        <td data-label={t('Delivered')}>{won(c.deliveredValue)}</td>
                        <td data-label={t('Approved')}>{won(c.approvedPayments)}</td>
                        <td data-label={t('Waiting')}>{won(c.pendingPayments)}</td>
                        <td data-label={t('Outstanding')}>
                          <b>{won(c.outstanding)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {tab === 'payments' ? (
        <PaymentReview contractor={contractor} onChange={summary.reload} />
      ) : null}
      {tab === 'deliveries' ? <DeliveriesAndHistory query={q} from={from} to={to} /> : null}
      {tab === 'settlement' ? (
        contractor ? (
          <SettlementAdmin contractorId={contractor} />
        ) : (
          <Empty>{t('Choose a contractor to see and edit its settlement schedule.')}</Empty>
        )
      ) : null}
    </div>
  );
}

/** AFD-8, PAY-3, PAY-7: review queue with proof, approve with allocation, reject with reason. */
function PaymentReview({ contractor, onChange }: { contractor: string; onChange: () => void }) {
  const q = contractor ? `&contractor_id=${contractor}` : '';
  const pending = useApi<{ items: Payment[] }>(`/payments?status=pending${q}`);
  const recent = useApi<{ items: Payment[] }>(`/payments?status=approved${q}`);
  const [open, setOpen] = useState<string | null>(null);
  const reload = () => {
    pending.reload();
    recent.reload();
    onChange();
  };
  return (
    <div className="stack">
      <section className="card">
        <h2>{t('Waiting for review')}</h2>
        <ErrorBox error={pending.error} onRetry={pending.reload} />
        {pending.data && !pending.data.items.length ? (
          <Empty>{t('No payments waiting.')}</Empty>
        ) : null}
        {pending.data?.items.map((p) => (
          <div
            key={p.id}
            className="stack"
            style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}
          >
            <div className="row between wrap">
              <span>
                <b>{p.contractor.name}</b> · {won(p.submittedAmount)} ·{' '}
                {formatDate(p.createdAt.slice(0, 10))}
                {p.note ? <span className="muted"> · “{p.note}”</span> : null}
              </span>
              <span className="row">
                <a className="btn ghost" href={p.proofUrl} target="_blank" rel="noreferrer">
                  {t('View proof')}
                </a>
                <button className="btn" onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {t('Review')}
                </button>
              </span>
            </div>
            {p.proofType.startsWith('image/') ? (
              <img
                className="photo"
                src={p.proofUrl}
                alt={t('Proof from {name}', { name: p.contractor.name })}
              />
            ) : null}
            {open === p.id ? (
              <ReviewForm
                payment={p}
                onDone={() => {
                  setOpen(null);
                  reload();
                }}
              />
            ) : null}
          </div>
        ))}
      </section>
      <section className="card">
        <h2>{t('Approved')}</h2>
        {recent.data && !recent.data.items.length ? (
          <Empty>{t('No approved payments yet.')}</Empty>
        ) : null}
        {recent.data?.items.slice(0, 30).map((p) => (
          <ApprovedRow key={p.id} p={p} onDone={reload} />
        ))}
      </section>
    </div>
  );
}

function ApprovedRow({ p, onDone }: { p: Payment; onDone: () => void }) {
  const [err, setErr] = useState<ApiError | null>(null);
  async function reverse() {
    const reason = window.prompt(t('Why is this payment being reversed? This is recorded.'));
    if (!reason?.trim()) return;
    setErr(null);
    try {
      await post(`/payments/${p.id}/reverse`, { reason: reason.trim() });
      onDone();
    } catch (e) {
      setErr(e as ApiError);
    }
  }
  return (
    <div
      className="row between wrap"
      style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}
    >
      <span>
        <b>{p.contractor.name}</b> · {won(p.approvedAmount)} on{' '}
        {p.paymentDate ? formatDate(p.paymentDate) : '—'}
        <br />
        <span className="muted small">
          {p.allocations
            .map((a) => `${a.deliveryDate ? formatDate(a.deliveryDate) : ''}: ${won(a.amount)}`)
            .join(' · ')}
        </span>
      </span>
      <button className="btn ghost" onClick={reverse}>
        {t('Reverse')}
      </button>
      <ErrorBox error={err} />
    </div>
  );
}

/** Rule 4: the approved amount is split across deliveries with something left to pay. */
function ReviewForm({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const [amount, setAmount] = useState(payment.submittedAmount);
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [split, setSplit] = useState<Record<string, number>>({});
  const [err, setErr] = useState<ApiError | null>(null);
  const open = useApi<{ items: FDelivery[] }>(
    // Deliveries can be completed ahead of their date, so look a month ahead too (400-day limit).
    `/finance/deliveries?contractor_id=${payment.contractor.id}&from=${today('Asia/Seoul', -369)}&to=${today('Asia/Seoul', 30)}`,
  );
  const owing = useMemo(
    () =>
      (open.data?.items ?? [])
        .filter((d) => d.remainingValue > 0)
        .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
    [open.data],
  );
  const allocated = Object.values(split).reduce((s, v) => s + (v || 0), 0);

  function oldestFirst() {
    let left = amount;
    const next: Record<string, number> = {};
    for (const d of owing) {
      if (left <= 0) break;
      const take = Math.min(left, d.remainingValue);
      next[d.id] = take;
      left -= take;
    }
    setSplit(next);
  }
  useEffect(() => {
    if (owing.length && !Object.keys(split).length) oldestFirst();
    // Fill once when the deliveries arrive.
  }, [owing.length]);

  async function approve(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const allocations = Object.entries(split)
        .filter(([, v]) => v > 0)
        .map(([deliveryId, v]) => ({ deliveryId, amount: v }));
      await post(`/payments/${payment.id}/approve`, {
        approvedAmount: amount,
        paymentDate: date,
        allocations,
      });
      onDone();
    } catch (e2) {
      setErr(e2 as ApiError);
    }
  }
  async function reject() {
    setErr(null);
    try {
      await post(`/payments/${payment.id}/reject`, { reason: reason.trim() });
      onDone();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <form
      className="stack"
      onSubmit={approve}
      style={{ background: 'var(--surface)', padding: 12, borderRadius: 10 }}
    >
      <ErrorBox error={err} />
      <div className="grid2">
        <label className="field">
          {t('Approved amount (won)')}
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Math.round(Number(e.target.value))))}
          />
          {amount !== payment.submittedAmount ? (
            <span className="small" style={{ color: 'var(--warn-ink)' }}>
              {t('Differs from the {submitted} submitted by {difference}.', {
                submitted: won(payment.submittedAmount),
                difference: won(amount - payment.submittedAmount),
              })}
            </span>
          ) : null}
        </label>
        <label className="field">
          {t('Payment date')}
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <div className="row between wrap">
        <b>{t('Allocate to deliveries')}</b>
        <button type="button" className="btn ghost" onClick={oldestFirst}>
          {t('Oldest first')}
        </button>
      </div>
      {open.loading && !open.data ? <Loading /> : null}
      {open.data && !owing.length ? (
        <Empty>{t('This contractor has no delivery left to pay.')}</Empty>
      ) : null}
      {owing.map((d) => (
        <label key={d.id} className="row between wrap">
          <span>
            {formatDate(d.deliveryDate)} · {t('value {amount}', { amount: won(d.totalValue) })} ·{' '}
            {t('left {amount}', { amount: won(d.remainingValue) })}
          </span>
          <input
            className="input qty"
            style={{ width: 130 }}
            type="number"
            min={0}
            max={d.remainingValue}
            value={split[d.id] ?? ''}
            onChange={(e) =>
              setSplit({ ...split, [d.id]: Math.max(0, Math.round(Number(e.target.value))) })
            }
            aria-label={t('Amount for {date}', { date: d.deliveryDate })}
          />
        </label>
      ))}
      <span
        className={allocated === amount ? 'pill ok' : 'pill warn'}
        style={{ alignSelf: 'flex-start' }}
      >
        Allocated {won(allocated)} of {won(amount)}
      </span>
      <div className="row wrap">
        <button className="btn" disabled={allocated !== amount || amount <= 0}>
          {t('Approve')}
        </button>
        <input
          className="input"
          placeholder={t('Reason for rejecting')}
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button type="button" className="btn ghost" disabled={!reason.trim()} onClick={reject}>
          {t('Reject')}
        </button>
      </div>
    </form>
  );
}

function DeliveriesAndHistory({ query, from, to }: { query: string; from: string; to: string }) {
  const deliveries = useApi<{ items: FDelivery[] }>(
    `/finance/deliveries?${query}from=${from}&to=${to}`,
  );
  const history = useApi<{ items: Event[] }>(`/finance/history?${query}from=${from}&to=${to}`);
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <section className="card">
        <h2>{t('Deliveries')}</h2>
        <ErrorBox error={deliveries.error} onRetry={deliveries.reload} />
        {deliveries.data && !deliveries.data.items.length ? (
          <Empty>{t('No completed deliveries in these dates.')}</Empty>
        ) : null}
        {deliveries.data?.items.map((d) => (
          <details key={d.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <summary className="row between wrap" style={{ cursor: 'pointer' }}>
              <span>
                <b>{formatDate(d.deliveryDate)}</b>
                {d.contractor ? <span className="muted"> · {d.contractor.name}</span> : null}
              </span>
              <span>
                {won(d.totalValue)} · {t('paid {amount}', { amount: won(d.paidValue) })} ·{' '}
                <b style={{ color: d.remainingValue > 0 ? 'var(--ink)' : 'var(--ok)' }}>
                  {t('left {amount}', { amount: won(d.remainingValue) })}
                </b>
              </span>
            </summary>
            <table className="t">
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.productName}>
                    <td>{l.productName}</td>
                    <td>
                      {l.deliveredQuantity} × {won(l.unitPrice)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <b>{won(l.lineValue)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))}
      </section>
      <section className="card">
        <h2>{t('History')}</h2>
        {history.data && !history.data.items.length ? (
          <Empty>{t('Nothing in these dates.')}</Empty>
        ) : null}
        {history.data?.items.map((e) => (
          <div
            key={`${e.kind}${e.id}`}
            className="row between wrap"
            style={{ borderTop: '1px solid #f1f3f8', paddingTop: 6 }}
          >
            <span>
              <span
                className={
                  e.kind === 'payment' ? 'pill ok' : e.kind === 'adjustment' ? 'pill warn' : 'pill'
                }
              >
                {e.kind === 'delivery'
                  ? t('Delivery')
                  : e.kind === 'payment'
                    ? `${t('Payment')} · ${t(PAY_STATUS[e.status]?.text ?? e.status)}`
                    : t('Adjustment')}
              </span>{' '}
              {formatDate(e.date)}
              {e.contractor ? <span className="muted"> · {e.contractor.name}</span> : null}
              {e.note ? <span className="muted small"> · {e.note}</span> : null}
            </span>
            <b>{won(e.amount)}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

function PeriodsTable({ items, onClose }: { items: Period[]; onClose?: (p: Period) => void }) {
  if (!items.length) return <Empty>{t('No settlement periods yet.')}</Empty>;
  return (
    <table className="t cards">
      <thead>
        <tr>
          <th>{t('Period')}</th>
          <th>{t('Opening')}</th>
          <th>{t('Delivered')}</th>
          <th>{t('Paid')}</th>
          <th>{t('Adjustments')}</th>
          <th>{t('Closing')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((p) => (
          <tr key={p.id}>
            <td data-label={t('Period')}>
              <b>
                {formatDate(p.startDate)} – {formatDate(p.endDate)}
              </b>{' '}
              <span className={p.status === 'closed' ? 'pill ok' : 'pill'}>
                {p.status === 'closed' ? t('Closed') : t('Open')}
              </span>
            </td>
            <td data-label={t('Opening')}>{won(p.openingBalance)}</td>
            <td data-label={t('Delivered')}>{won(p.deliveredValue)}</td>
            <td data-label={t('Paid')}>{won(p.approvedPayments)}</td>
            <td data-label={t('Adjustments')}>{won(p.adjustments)}</td>
            <td data-label={t('Closing')}>
              <b>{won(p.closingBalance)}</b>
            </td>
            <td data-label="">
              {onClose && p.status === 'open' && p.endDate < today() ? (
                <button className="btn ghost" onClick={() => onClose(p)}>
                  {t('Close')}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** SET-1 to SET-6 for one contractor: reports, closing, and the editor for open periods. */
function SettlementAdmin({ contractorId }: { contractorId: string }) {
  const schedule = useApi<{ items: Period[] }>(
    `/settlement-schedules?contractor_id=${contractorId}`,
  );
  const [rows, setRows] = useState<
    { startDate: string; endDate: string; kind: 'mid_month' | 'month_end' | 'custom' }[] | null
  >(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const items = schedule.data?.items ?? [];
  const closed = items.filter((p) => p.status === 'closed');
  const editable =
    rows ??
    items
      .filter((p) => p.status === 'open')
      .map((p) => ({ startDate: p.startDate, endDate: p.endDate, kind: p.kind }));

  async function close(p: Period) {
    if (
      !window.confirm(
        t('Close {start} to {end}? Its report is then fixed for good.', {
          start: p.startDate,
          end: p.endDate,
        }),
      )
    )
      return;
    setErr(null);
    try {
      await post(`/settlement-reports/${p.id}/close`);
      schedule.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  /** Mid-month (1–15) and month-end (16–last day) for the next three months, after what is closed. */
  function fillDefault() {
    const lastClosed = closed.at(-1)?.endDate;
    const running = items.find((p) => p.status === 'open' && p.startDate <= today());
    let start =
      running?.startDate ?? (lastClosed ? addDay(lastClosed) : `${today().slice(0, 8)}01`);
    const out: typeof editable = [];
    while (out.length < 6) {
      const [y, m, d] = start.split('-').map(Number) as [number, number, number];
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end =
        d <= 15 ? `${start.slice(0, 8)}15` : `${start.slice(0, 8)}${String(last).padStart(2, '0')}`;
      out.push({ startDate: start, endDate: end, kind: d <= 15 ? 'mid_month' : 'month_end' });
      start = addDay(end);
    }
    setRows(out);
  }

  async function save() {
    setErr(null);
    setMsg(null);
    try {
      await put(`/contractors/${contractorId}/settlement-schedule`, { periods: editable });
      setRows(null);
      setMsg(t('Saved. Closed periods are unchanged.'));
      schedule.reload();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>{t('Reports')}</h2>
        <ErrorBox error={schedule.error ?? err} />
        {schedule.loading && !schedule.data ? <Loading /> : null}
        <PeriodsTable items={items} onClose={close} />
      </section>
      <section className="card">
        <div className="row between wrap">
          <h2>{t('Schedule')}</h2>
          <button className="btn ghost" onClick={fillDefault}>
            {t('Fill 1–15 and 16–end for 3 months')}
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          {t(
            'Periods follow each other day by day. Closed periods are locked; a period already under way keeps its start but its end can move.',
          )}
        </p>
        {msg ? <span className="pill ok">{msg}</span> : null}
        {editable.map((r, i) => (
          <div key={i} className="row wrap">
            <input
              className="input"
              type="date"
              value={r.startDate}
              onChange={(e) =>
                setRows(editable.map((x, j) => (j === i ? { ...x, startDate: e.target.value } : x)))
              }
              aria-label={t('Start')}
            />
            <span className="muted">{t('to')}</span>
            <input
              className="input"
              type="date"
              value={r.endDate}
              onChange={(e) =>
                setRows(
                  editable.map((x, j) =>
                    j === i
                      ? { ...x, endDate: e.target.value }
                      : j === i + 1
                        ? { ...x, startDate: addDay(e.target.value) }
                        : x,
                  ),
                )
              }
              aria-label={t('End')}
            />
            <select
              className="input"
              value={r.kind}
              onChange={(e) =>
                setRows(
                  editable.map((x, j) =>
                    j === i ? { ...x, kind: e.target.value as typeof r.kind } : x,
                  ),
                )
              }
              aria-label={t('Kind')}
            >
              <option value="mid_month">{t('Mid-month')}</option>
              <option value="month_end">{t('Month-end')}</option>
              <option value="custom">{t('Other')}</option>
            </select>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setRows(editable.filter((_, j) => j !== i))}
              aria-label={t('Remove period')}
            >
              ×
            </button>
          </div>
        ))}
        <div className="row wrap">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const last = editable.at(-1)?.endDate ?? closed.at(-1)?.endDate;
              const start = last ? addDay(last) : today();
              setRows([...editable, { startDate: start, endDate: start, kind: 'custom' }]);
            }}
          >
            {t('Add period')}
          </button>
          <button className="btn" disabled={!rows} onClick={save}>
            {t('Save schedule')}
          </button>
        </div>
      </section>
    </div>
  );
}

function addDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ contractor admin

function ContractorFinance() {
  const providers = useApi<{ items: { id: string; name: string }[] }>('/providers');
  const [provider, setProvider] = useState('');
  useEffect(() => {
    if (!provider && providers.data?.items[0]) setProvider(providers.data.items[0].id);
  }, [providers.data, provider]);
  const [tab, setTab] = useState<'overview' | 'pay' | 'schedule'>('overview');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today('Asia/Seoul', 30));
  const summary = useApi<Summary>(
    provider ? `/finance/summary?provider_id=${provider}&from=${from}&to=${to}` : null,
  );

  if (providers.loading) return <Loading />;
  if (!providers.data?.items.length) {
    return (
      <div className="page">
        <PageHead title={t('Finance')} />
        <Empty>{t('No bakery has approved you yet.')}</Empty>
      </div>
    );
  }
  const mine = summary.data?.contractors[0];
  return (
    <div className="page">
      <PageHead title={t('Finance')}>
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            ['overview', 'Overview'],
            ['pay', 'Payments'],
            ['schedule', 'Settlement'],
          ]}
        />
      </PageHead>
      {providers.data.items.length > 1 ? (
        <select
          className="input"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          aria-label={t('Bakery')}
        >
          {providers.data.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}
      {tab === 'overview' ? (
        <>
          <Range
            from={from}
            to={to}
            onChange={(a, b) => {
              setFrom(a);
              setTo(b);
            }}
          />
          <ErrorBox error={summary.error} onRetry={summary.reload} />
          {mine ? <Cards s={mine} /> : <Loading />}
          {provider ? (
            <DeliveriesAndHistory query={`provider_id=${provider}&`} from={from} to={to} />
          ) : null}
        </>
      ) : null}
      {tab === 'pay' && provider ? (
        <ContractorPayments
          provider={provider}
          outstanding={mine?.outstanding ?? 0}
          onChange={summary.reload}
        />
      ) : null}
      {tab === 'schedule' && provider ? <ContractorSchedule provider={provider} /> : null}
    </div>
  );
}

/** PAY-1, PAY-2, F2: submit with proof; see status and reasons; withdraw a pending one. */
function ContractorPayments({
  provider,
  outstanding,
  onChange,
}: {
  provider: string;
  outstanding: number;
  onChange: () => void;
}) {
  const list = useApi<{ items: Payment[] }>(`/payments?provider_id=${provider}`);
  const [amount, setAmount] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !amount) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('providerId', provider);
      form.append('amount', String(amount));
      if (note.trim()) form.append('note', note.trim());
      form.append('proof', file);
      await api('POST', '/payments', { form });
      setAmount('');
      setNote('');
      setFile(null);
      setMsg(t('Sent. It counts once the bakery approves it.'));
      list.reload();
      onChange();
    } catch (e2) {
      setErr(e2 as ApiError);
    } finally {
      setBusy(false);
    }
  }
  async function withdraw(id: string) {
    if (!window.confirm(t('Withdraw this payment confirmation?'))) return;
    try {
      await post(`/payments/${id}/cancel`);
      list.reload();
      onChange();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <h2>{t('Confirm a payment')}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {t('Outstanding now:')} <b>{won(outstanding)}</b>. {t('You can pay part of it.')}
        </p>
        <ErrorBox error={err} />
        {msg ? <span className="pill ok">{msg}</span> : null}
        <div className="grid2">
          <label className="field">
            {t('Amount paid (won)')}
            <input
              type="number"
              min={1}
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value ? Math.round(Number(e.target.value)) : '')}
            />
          </label>
          <label className="field">
            {t('Proof (transfer receipt: photo or PDF, up to 10 MB)')}
            <input
              type="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
        <label className="field">
          {t('Note (optional)')}
          <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn" disabled={busy || !file || !amount}>
          {busy ? t('Sending…') : t('Send to the bakery')}
        </button>
      </form>
      <section className="card">
        <h2>{t('My payments')}</h2>
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.data && !list.data.items.length ? <Empty>{t('No payments yet.')}</Empty> : null}
        {list.data?.items.map((p) => {
          const s = PAY_STATUS[p.status] ?? { text: p.status, cls: 'pill' };
          return (
            <div
              key={p.id}
              className="row between wrap"
              style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}
            >
              <span>
                <b>{won(p.approvedAmount ?? p.submittedAmount)}</b> ·{' '}
                {formatDate(p.createdAt.slice(0, 10))} <span className={s.cls}>{t(s.text)}</span>
                {p.rejectionReason ? (
                  <span className="muted small"> · {p.rejectionReason}</span>
                ) : null}
                {p.reversedReason ? (
                  <span className="muted small"> · {p.reversedReason}</span>
                ) : null}
              </span>
              {p.status === 'pending' ? (
                <button className="btn ghost" onClick={() => withdraw(p.id)}>
                  {t('Withdraw')}
                </button>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function ContractorSchedule({ provider }: { provider: string }) {
  const schedule = useApi<{ items: Period[] }>(`/settlement-schedules?provider_id=${provider}`);
  return (
    <section className="card">
      <h2>{t('My settlement schedule')}</h2>
      <ErrorBox error={schedule.error} onRetry={schedule.reload} />
      {schedule.loading && !schedule.data ? <Loading /> : null}
      {schedule.data ? <PeriodsTable items={schedule.data.items} /> : null}
    </section>
  );
}
