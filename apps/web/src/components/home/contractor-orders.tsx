'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type ApiError, formatDate, post, type Schemas, today } from '../../lib/api';
import { useApi } from '../../lib/use-api';
import { Empty, ErrorBox, Loading, PageHead } from '../ui';

type Order = Schemas['Order'];

/** A contractor's upcoming orders. Changes go to the provider as requests (decision 2026-11-13). */
export function ContractorOrders() {
  const from = today();
  const to = today('Asia/Seoul', 60);
  const { data, error, loading, reload } = useApi<{ items: Order[] }>(
    `/orders?from=${from}&to=${to}`,
  );
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="page">
      <PageHead title="My orders" sub="Upcoming deliveries">
        <Link className="btn" href="/app/orders/new">
          New order
        </Link>
      </PageHead>
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.items.length ? (
        <Empty>No upcoming orders. Place one with New order.</Empty>
      ) : null}
      {data?.items.map((o) => (
        <section key={o.id} className="card">
          <div className="row between wrap">
            <div>
              <h2>{formatDate(o.deliveryDate)}</h2>
              <span className="muted small">From {o.provider.name}</span>
            </div>
            <div className="row">
              {o.status === 'cancelled' ? <span className="pill">Cancelled</span> : null}
              {o.openChangeRequestIds.length ? (
                <span className="pill warn">Change waiting</span>
              ) : null}
              {o.status === 'placed' && editing !== o.id ? (
                <button className="btn ghost" onClick={() => setEditing(o.id)}>
                  Request a change
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
        Set 0 to remove a product. Smaller quantities and removals need the provider admin;
        additions can be accepted by staff.
      </p>
      <ErrorBox error={error} />
      {order.lines.map((l) => (
        <label key={l.productId} className="row between">
          <span>{l.productName}</span>
          <input
            className="input qty"
            type="number"
            min={0}
            inputMode="numeric"
            value={qty[l.productId] ?? 0}
            onChange={(e) => setQty({ ...qty, [l.productId]: Math.max(0, Number(e.target.value)) })}
          />
        </label>
      ))}
      <label className="field">
        Note (optional)
        <textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn" disabled={busy} onClick={send}>
          Send request
        </button>
        <button className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
