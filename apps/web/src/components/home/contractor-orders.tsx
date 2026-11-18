'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type ApiError, formatDate, post, type Schemas, today } from '../../lib/api';
import { useApi } from '../../lib/use-api';
import { AddProduct, Empty, ErrorBox, Loading, PageHead } from '../ui';
import { t } from '../../lib/i18n';

type Order = Schemas['Order'];

/** A contractor's upcoming orders. Changes go to the provider as requests (decision 2026-11-13). */
export function ContractorOrders() {
  // Last week too: an order not delivered yet is still due (TOD-2).
  const from = today('Asia/Seoul', -7);
  const to = today('Asia/Seoul', 54);
  const { data, error, loading, reload } = useApi<{ items: Order[] }>(
    `/orders?from=${from}&to=${to}`,
  );
  const [editing, setEditing] = useState<string | null>(null);
  // A delivered order is locked; differences go through Deliveries instead (DEL-5, DEL-6).
  const deliveries = useApi<{ items: Schemas['Delivery'][] }>(`/deliveries?from=${from}&to=${to}`);
  const delivered = new Set(
    (deliveries.data?.items ?? [])
      .filter((d) => d.status !== 'not_started' && d.status !== 'draft')
      .map((d) => `${d.provider.id}:${d.deliveryDate}`),
  );

  return (
    <div className="page">
      <PageHead title={t('My orders')} sub="Upcoming deliveries and last week">
        <Link className="btn" href="/app/orders/new">
          {t('New order')}
        </Link>
      </PageHead>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>{t('No upcoming orders. Place one with New order.')}</Empty>
      ) : null}
      {data?.items.map((o) => (
        <section key={o.id} className="card">
          <div className="row between wrap">
            <div>
              <h2>{formatDate(o.deliveryDate)}</h2>
              <span className="muted small">
                {t('From {name}', { name: o.provider.name })}
                {o.approxTime
                  ? ` · ${t('about {start}–{end}', { start: o.approxTime.start, end: o.approxTime.end })}`
                  : ''}
              </span>
            </div>
            <div className="row">
              {o.status === 'cancelled' ? <span className="pill">{t('Cancelled')}</span> : null}
              {o.openChangeRequestIds.length ? (
                <span className="pill warn">{t('Change waiting')}</span>
              ) : null}
              {delivered.has(`${o.provider.id}:${o.deliveryDate}`) ? (
                <Link className="pill ok" href="/app/deliveries">
                  {t('Delivered')}
                </Link>
              ) : null}
              {o.status === 'placed' &&
              editing !== o.id &&
              deliveries.data &&
              !delivered.has(`${o.provider.id}:${o.deliveryDate}`) ? (
                <button className="btn ghost" onClick={() => setEditing(o.id)}>
                  {t('Request a change')}
                </button>
              ) : null}
            </div>
          </div>
          {editing === o.id ? (
            <ChangeForm
              order={o}
              onDone={() => {
                setEditing(null);
                reload();
              }}
            />
          ) : (
            <table className="t">
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.productId}>
                    <td>{l.productName}</td>
                    <td style={{ textAlign: 'right' }}>
                      <b>{l.quantity}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function ChangeForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(order.lines.map((l) => [l.productId, l.quantity])),
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const catalog = useApi<{ items: Schemas['CatalogItem'][] }>(
    `/catalog?provider_id=${order.provider.id}`,
  );
  const names = new Map([
    ...(catalog.data?.items ?? []).map((i) => [i.id, i.name] as const),
    ...order.lines.map((l) => [l.productId, l.productName] as const),
  ]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const lines = Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([productId, quantity]) => ({ productId, quantity }));
      await post(`/orders/${order.id}/change-requests`, {
        lines,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <p className="muted small">
        {t(
          'Set 0 to remove a product. Smaller quantities and removals need the provider admin; additions can be accepted by staff.',
        )}
      </p>
      <ErrorBox error={error} />
      {Object.keys(qty).map((id) => (
        <label key={id} className="row between">
          <span>{names.get(id) ?? t('Product')}</span>
          <input
            className="input qty"
            type="number"
            min={0}
            inputMode="numeric"
            value={qty[id] ?? 0}
            onChange={(e) => setQty({ ...qty, [id]: Math.max(0, Number(e.target.value)) })}
          />
        </label>
      ))}
      <AddProduct
        options={(catalog.data?.items ?? []).filter((i) => !(i.id in qty))}
        onAdd={(id) => setQty({ ...qty, [id]: 1 })}
      />
      <label className="field">
        {t('Note (optional)')}
        <textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn" disabled={busy} onClick={send}>
          {t('Send request')}
        </button>
        <button className="btn ghost" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </div>
  );
}
