'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { AddProduct, Empty, ErrorBox, Flag, Loading, PageHead } from '../../../components/ui';
import {
  type ApiError,
  formatDate,
  formatTime,
  get,
  post,
  put,
  type Schemas,
  today,
} from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Delivery = Schemas['Delivery'];
type Contractor = Schemas['ContractorWithTime'];

const STATUS: Record<Delivery['status'], string> = {
  not_started: 'Not started',
  draft: 'Draft',
  completed: 'Waiting for contractor',
  confirmed: 'Confirmed',
  change_requested: 'Change requested',
};
const pillFor = (s: Delivery['status']) =>
  s === 'confirmed'
    ? 'pill ok'
    : s === 'change_requested'
      ? 'pill warn'
      : s === 'completed'
        ? 'pill blue'
        : 'pill';

export default function DeliveriesPage() {
  const { actor } = useSession();
  return (
    <Suspense fallback={<Loading />}>
      {actor === 'contractor_admin' ? <ContractorDeliveries /> : <ProviderDeliveries />}
    </Suspense>
  );
}

/** DEL-1 to DEL-6 for the provider: one delivery per contractor per day, ordered vs delivered. */
function ProviderDeliveries() {
  const params = useSearchParams();
  const [date, setDate] = useState(params.get('date') ?? today());
  // Open on the delivery due next (TOD rules), not the calendar day, unless a date was asked for.
  const due = useApi<Schemas['DueNextOrders']>(params.get('date') ? null : '/orders/due-next');
  const dueDate = due.data?.orders[0]?.deliveryDate;
  useEffect(() => {
    if (dueDate) setDate(dueDate);
  }, [dueDate]);
  const [selected, setSelected] = useState<string | null>(params.get('contractor'));
  const contractors = useApi<{ items: Contractor[] }>('/contractors');
  const list = useApi<{ items: Delivery[] }>(`/deliveries?from=${date}&to=${date}`, 30_000);
  const byContractor = new Map((list.data?.items ?? []).map((d) => [d.contractor.id, d]));

  return (
    <div className="page wide">
      <PageHead title={t('Deliveries')}>
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Delivery date')}
        />
      </PageHead>
      <ErrorBox
        error={contractors.error ?? list.error}
        onRetry={() => {
          contractors.reload();
          list.reload();
        }}
      />
      {contractors.loading ? <Loading /> : null}
      {contractors.data && !contractors.data.items.length ? (
        <Empty>{t('No approved contractors yet. Approve applications under People.')}</Empty>
      ) : null}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <section className="card" style={{ padding: 8 }}>
          {contractors.data?.items
            .slice()
            .sort((a, b) =>
              (a.approxTime?.start ?? '99').localeCompare(b.approxTime?.start ?? '99'),
            )
            .map((c) => {
              const d = byContractor.get(c.contractor.id);
              return (
                <button
                  key={c.contractor.id}
                  type="button"
                  className="row between"
                  onClick={() => setSelected(c.contractor.id)}
                  style={{
                    minHeight: 56,
                    padding: '6px 10px',
                    border: 'none',
                    borderRadius: 10,
                    background: selected === c.contractor.id ? 'var(--soft)' : '#fff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                  }}
                >
                  <span>
                    <b>{c.contractor.name}</b>
                    <br />
                    <span className="muted small">
                      {c.approxTime
                        ? `About ${c.approxTime.start}–${c.approxTime.end}`
                        : t('No time set')}
                    </span>
                  </span>
                  <span className={pillFor(d?.status ?? 'not_started')}>
                    {t(STATUS[d?.status ?? 'not_started'])}
                  </span>
                </button>
              );
            })}
        </section>
        {selected ? (
          <DeliveryEditor
            key={`${selected}${date}`}
            contractorId={selected}
            date={date}
            contractor={contractors.data?.items.find((c) => c.contractor.id === selected)}
            onChange={list.reload}
            onTimeChange={contractors.reload}
          />
        ) : (
          <Empty>{t('Choose a contractor to record what was delivered.')}</Empty>
        )}
      </div>
    </div>
  );
}

function DeliveryEditor({
  contractorId,
  date,
  contractor,
  onChange,
  onTimeChange,
}: {
  contractorId: string;
  date: string;
  contractor?: Contractor;
  onChange: () => void;
  onTimeChange: () => void;
}) {
  const { isAdmin } = useRoles();
  const [correcting, setCorrecting] = useState(false);
  const [d, setD] = useState<Delivery | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState(contractor?.approxTime?.start ?? '');
  const [end, setEnd] = useState(contractor?.approxTime?.end ?? '');
  const products = useApi<{ items: Schemas['Product'][] }>('/products');

  async function load() {
    try {
      const res = await get<Delivery>(`/deliveries/${contractorId}/${date}`);
      setD(res);
      setQty(Object.fromEntries(res.lines.map((l) => [l.productId, l.deliveredQuantity])));
      setError(null);
    } catch (e) {
      setError(e as ApiError);
    }
  }
  useEffect(() => {
    void load();
  }, [contractorId, date]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChange();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (!d) return error ? <ErrorBox error={error} onRetry={load} /> : <Loading />;
  const editable = d.status === 'not_started' || d.status === 'draft';
  // DEL-4: products added here that were not ordered become unordered lines when saved.
  const names = new Map((products.data?.items ?? []).map((p) => [p.id, p.name]));
  const rows = [
    ...d.lines,
    ...Object.keys(qty)
      .filter((id) => !d.lines.some((l) => l.productId === id))
      .map((id) => ({
        productId: id,
        productName: names.get(id) ?? t('Product'),
        orderedQuantity: 0,
        deliveredQuantity: qty[id] ?? 0,
        difference: qty[id] ?? 0,
        isUnordered: true,
      })),
  ];
  const addable = (products.data?.items ?? []).filter(
    (p) => !rows.some((r) => r.productId === p.id),
  );
  const save = () =>
    put<Delivery>(`/deliveries/${contractorId}/${date}`, {
      lines: Object.entries(qty).map(([productId, deliveredQuantity]) => ({
        productId,
        deliveredQuantity,
      })),
    });

  return (
    <section className="card">
      <div className="row between wrap">
        <div>
          <h2>{d.contractor.name}</h2>
          <span className="muted small">
            {formatDate(d.deliveryDate)}
            {d.window?.start ? ` · ${formatTime(d.window.start)}–${formatTime(d.window.end)}` : ''}
          </span>
        </div>
        <span className={pillFor(d.status)}>{t(STATUS[d.status])}</span>
      </div>
      <ErrorBox error={error} />
      {!rows.length ? <Empty>{t('No order for this day.')}</Empty> : null}
      {rows.length ? (
        <table className="t cards">
          <thead>
            <tr>
              <th>{t('Product')}</th>
              <th>{t('Ordered')}</th>
              <th>{t('Delivered')}</th>
              <th>{t('Difference')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const delivered = qty[l.productId] ?? l.deliveredQuantity;
              const diff = delivered - l.orderedQuantity;
              return (
                <tr key={l.productId}>
                  <td data-label={t('Product')}>
                    <b>{l.productName}</b>
                    {l.isUnordered ? (
                      <span className="pill warn" style={{ marginLeft: 6 }}>
                        {t('Not ordered')}
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('Ordered')}>{l.orderedQuantity}</td>
                  <td data-label={t('Delivered')}>
                    {editable ? (
                      <input
                        className="input qty"
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-label={`${l.productName} delivered`}
                        value={delivered}
                        onChange={(e) =>
                          setQty({ ...qty, [l.productId]: Math.max(0, Number(e.target.value)) })
                        }
                      />
                    ) : (
                      <b>{l.deliveredQuantity}</b>
                    )}
                  </td>
                  <td data-label={t('Difference')}>
                    {diff === 0 ? (
                      <span className="muted">0</span>
                    ) : (
                      <Flag>{diff > 0 ? `+${diff}` : diff}</Flag>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <PendingChange
        d={d}
        mySide="provider"
        canDecide={isAdmin}
        busy={busy}
        onDecide={(decision) =>
          act(() =>
            post(`/deliveries/${d.id}/change-requests/${d.pendingChange?.id}/decision`, {
              decision,
            }),
          )
        }
      />
      {/* Decided 2026-11-28: the bakery can ask to correct a recorded delivery too. */}
      {isAdmin && (d.status === 'completed' || d.status === 'confirmed') && d.id ? (
        correcting ? (
          <CorrectionForm
            d={d}
            busy={busy}
            onCancel={() => setCorrecting(false)}
            onSend={(lines, reason) =>
              act(async () => {
                await post(`/deliveries/${d.id}/change-requests`, { lines, reason });
                setCorrecting(false);
              })
            }
          />
        ) : (
          <button
            className="btn ghost"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setCorrecting(true)}
          >
            {t('Ask for a correction')}
          </button>
        )
      ) : null}
      {editable ? (
        <AddProduct
          options={addable}
          label={t('Add a product that was not ordered…')}
          onAdd={(id) => setQty({ ...qty, [id]: 1 })}
        />
      ) : null}
      {editable && rows.length ? (
        <div className="row wrap">
          <button className="btn ghost" disabled={busy} onClick={() => act(save)}>
            {t('Save draft')}
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const saved = await save();
                await post(`/deliveries/${saved.id}/complete`);
              })
            }
          >
            {t('Delivery completed')}
          </button>
        </div>
      ) : null}
      {isAdmin ? (
        <details>
          <summary className="muted">
            {t('Approximate delivery time for {name}', { name: d.contractor.name ?? '' })}
          </summary>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <input
              className="input"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              aria-label={t('From')}
            />
            <input
              className="input"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              aria-label={t('To')}
            />
            <button
              className="btn ghost"
              disabled={busy || !start || !end}
              onClick={() =>
                act(async () => {
                  await put(`/contractors/${contractorId}/approx-time`, { start, end });
                  onTimeChange();
                })
              }
            >
              {t('Save time')}
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
}

type DeliveryRow = Schemas['Delivery'];

/**
 * Decided 2026-11-28: a correction waiting for an answer. The side that asked sees that it is
 * waiting; the other side sees each product's current and asked number, and approves or rejects.
 */
function PendingChange({
  d,
  mySide,
  canDecide,
  busy,
  onDecide,
}: {
  d: DeliveryRow;
  mySide: 'provider' | 'contractor';
  canDecide: boolean;
  busy: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}) {
  const p = d.pendingChange;
  if (!p) return null;
  const mine = (p.requestedBy ?? 'contractor') === mySide;
  const other = mySide === 'provider' ? d.contractor.name : d.provider.name;
  return (
    <div className="stack change-box" data-testid="pending-change">
      <b>
        {mine
          ? t('Your correction is waiting for {name} to answer.', { name: other ?? '' })
          : t('{name} asks for a correction', { name: other ?? '' })}
      </b>
      {p.reason ? <span>“{p.reason}”</span> : null}
      {p.lines?.map((l) => {
        const line = d.lines.find((x) => x.productId === l.productId);
        return (
          <span key={l.productId}>
            {line?.productName ?? t('Product')}: {line?.deliveredQuantity ?? 0} →{' '}
            <b>{l.deliveredQuantity}</b>
          </span>
        );
      })}
      {!mine && canDecide ? (
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => onDecide('approve')}>
            {t('Approve')}
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => onDecide('reject')}>
            {t('Reject')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Decided 2026-11-28: the bakery asks to correct some products of a recorded delivery. */
function CorrectionForm({
  d,
  busy,
  onSend,
  onCancel,
}: {
  d: DeliveryRow;
  busy: boolean;
  onSend: (lines: { productId: string; deliveredQuantity: number }[], reason: string) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const changed = Object.entries(qty).filter(
    ([id, n]) => d.lines.find((l) => l.productId === id)?.deliveredQuantity !== n,
  );
  return (
    <div className="stack change-box">
      <b>{t('Ask {name} to correct', { name: d.contractor.name ?? '' })}</b>
      {d.lines.map((l) => (
        <label key={l.productId} className="row between">
          <span>{l.productName}</span>
          <input
            className="input qty"
            type="number"
            min={0}
            inputMode="numeric"
            aria-label={t('{name} delivered', { name: l.productName })}
            value={qty[l.productId] ?? l.deliveredQuantity}
            onChange={(e) => setQty({ ...qty, [l.productId]: Math.max(0, Number(e.target.value)) })}
          />
        </label>
      ))}
      <label className="field">
        {t('Why?')}
        <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="row">
        <button
          className="btn"
          disabled={busy || !changed.length || !reason.trim()}
          onClick={() =>
            onSend(
              changed.map(([productId, deliveredQuantity]) => ({ productId, deliveredQuantity })),
              reason.trim(),
            )
          }
        >
          {t('Send to {name}', { name: d.contractor.name ?? '' })}
        </button>
        <button className="btn ghost" onClick={onCancel}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}

function useRoles() {
  const { actor } = useSession();
  return { isAdmin: actor === 'org_admin' };
}

/** DEL-5, DEL-6 for the contractor: confirm a completed delivery or ask for a change. */
function ContractorDeliveries() {
  const from = today('Asia/Seoul', -14);
  const to = today('Asia/Seoul', 7);
  const { data, error, loading, reload } = useApi<{ items: Delivery[] }>(
    `/deliveries?from=${from}&to=${to}`,
    60_000,
  );
  const [changing, setChanging] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setChanging(null);
      reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const items = [...(data?.items ?? [])].sort((a, b) =>
    b.deliveryDate.localeCompare(a.deliveryDate),
  );
  return (
    <div className="page">
      <PageHead title={t('Deliveries')} sub="Last two weeks" />
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error ?? err} onRetry={reload} />
      {data && !items.length ? <Empty>{t('No deliveries yet.')}</Empty> : null}
      {items.map((d) => (
        <section key={d.id ?? d.deliveryDate} className="card">
          <div className="row between wrap">
            <div>
              <h2>{formatDate(d.deliveryDate)}</h2>
              <span className="muted small">From {d.provider.name}</span>
            </div>
            <span className={pillFor(d.status)}>{t(STATUS[d.status])}</span>
          </div>
          <table className="t">
            <thead>
              <tr>
                <th>{t('Product')}</th>
                <th>{t('Ordered')}</th>
                <th>{t('Delivered')}</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.productId}>
                  <td>{l.productName}</td>
                  <td>{l.orderedQuantity}</td>
                  <td>
                    {changing === d.id ? (
                      <input
                        className="input qty"
                        type="number"
                        min={0}
                        value={qty[l.productId] ?? l.deliveredQuantity}
                        onChange={(e) =>
                          setQty({ ...qty, [l.productId]: Math.max(0, Number(e.target.value)) })
                        }
                        aria-label={`${l.productName} delivered`}
                      />
                    ) : (
                      <span className="row">
                        <b>{l.deliveredQuantity}</b>
                        {l.difference ? (
                          <Flag>{l.difference > 0 ? `+${l.difference}` : l.difference}</Flag>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PendingChange
            d={d}
            mySide="contractor"
            canDecide
            busy={busy}
            onDecide={(decision) =>
              act(() =>
                post(`/deliveries/${d.id}/change-requests/${d.pendingChange?.id}/decision`, {
                  decision,
                }),
              )
            }
          />
          {/* Decided 2026-11-28: "Something is wrong" also after confirming. */}
          {(d.status === 'completed' || d.status === 'confirmed') && changing !== d.id ? (
            <div className="row wrap">
              {d.status === 'completed' ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => act(() => post(`/deliveries/${d.id}/confirm`))}
                >
                  {t('Confirm delivery')}
                </button>
              ) : null}
              <button
                className="btn ghost"
                onClick={() => {
                  setChanging(d.id);
                  setQty({});
                  setReason('');
                }}
              >
                {t('Something is wrong')}
              </button>
            </div>
          ) : null}
          {changing === d.id ? (
            <div className="stack">
              <label className="field">
                {t('What is wrong?')}
                <textarea
                  required
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="row">
                <button
                  className="btn"
                  disabled={busy || !reason.trim() || !Object.keys(qty).length}
                  onClick={() =>
                    act(() =>
                      post(`/deliveries/${d.id}/change-requests`, {
                        reason: reason.trim(),
                        lines: Object.entries(qty)
                          .filter(
                            ([productId, n]) =>
                              d.lines.find((l) => l.productId === productId)?.deliveredQuantity !==
                              n,
                          )
                          .map(([productId, deliveredQuantity]) => ({
                            productId,
                            deliveredQuantity,
                          })),
                      }),
                    )
                  }
                >
                  {t('Send to the bakery')}
                </button>
                <button className="btn ghost" onClick={() => setChanging(null)}>
                  {t('Cancel')}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}
