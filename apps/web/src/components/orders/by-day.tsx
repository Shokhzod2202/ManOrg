'use client';

import { useEffect, useState } from 'react';
import { type ApiError, formatDate, put, type Schemas, today } from '../../lib/api';
import { useApi } from '../../lib/use-api';
import { Empty, ErrorBox, Loading } from '../ui';
import { t } from '../../lib/i18n';

type Order = Schemas['Order'];
type Product = Schemas['Product'];

/** ORD-4: orders for any delivery day, by contractor, with production totals and corrections. */
export function OrdersByDay({ canEdit }: { canEdit: boolean }) {
  const [date, setDate] = useState(today());
  // Opens on the next delivery due, like Deliveries; any other day is one pick away.
  const due = useApi<Schemas['DueNextOrders']>('/orders/due-next');
  const dueDate = due.data?.orders[0]?.deliveryDate;
  useEffect(() => {
    if (dueDate) setDate(dueDate);
  }, [dueDate]);
  const orders = useApi<{ items: Order[] }>(`/orders?from=${date}&to=${date}`);
  const totals = useApi<Schemas['OrderTotals']>(`/orders/totals?delivery_date=${date}`);
  const products = useApi<{ items: Product[] }>(canEdit ? '/products' : null);
  const [editing, setEditing] = useState<string | null>(null);
  const reload = () => {
    orders.reload();
    totals.reload();
  };
  const placed = (orders.data?.items ?? []).filter((o) => o.status === 'placed');

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="viewbar">
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label={t('Delivery date')}
        />
        <span className="muted">
          {t('{orders} orders · {units} items', {
            orders: placed.length,
            units: (totals.data?.items ?? []).reduce((n, x) => n + x.quantity, 0),
          })}
        </span>
      </div>
      {orders.loading && !orders.data ? <Loading /> : null}
      <ErrorBox error={orders.error ?? totals.error} onRetry={reload} />
      {orders.data && !orders.data.items.length ? (
        <Empty>{t('No orders for {date}.', { date: formatDate(date) })}</Empty>
      ) : null}
      {orders.data?.items.length ? (
        <div className="grid2" style={{ alignItems: 'start' }}>
          <section className="card">
            <h2>{t('Production totals')}</h2>
            <table className="t">
              <tbody>
                {[...(totals.data?.items ?? [])]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((x) => (
                    <tr key={x.productId}>
                      <td>{x.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        <b>{x.quantity}</b>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
          <div className="stack">
            {orders.data.items.map((o) =>
              editing === o.id ? (
                <EditOrder
                  key={o.id}
                  order={o}
                  products={products.data?.items ?? []}
                  onDone={() => {
                    setEditing(null);
                    reload();
                  }}
                />
              ) : (
                <section key={o.id} className="card">
                  <div className="row between wrap">
                    <h2>{o.contractor.name}</h2>
                    <span className="row">
                      {o.status === 'cancelled' ? (
                        <span className="pill">{t('Cancelled')}</span>
                      ) : null}
                      {o.openChangeRequestIds.length ? (
                        <span className="pill warn">{t('Change waiting')}</span>
                      ) : null}
                      {canEdit && o.status === 'placed' ? (
                        <button className="btn ghost" onClick={() => setEditing(o.id)}>
                          {t('Correct')}
                        </button>
                      ) : null}
                    </span>
                  </div>
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
                </section>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The provider admin's direct correction; audited on the server, and the contractor is told. */
function EditOrder({
  order,
  products,
  onDone,
}: {
  order: Order;
  products: Product[];
  onDone: () => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>(
    Object.fromEntries(order.lines.map((l) => [l.productId, l.quantity])),
  );
  const [add, setAdd] = useState('');
  const [err, setErr] = useState<ApiError | null>(null);
  const names = new Map([
    ...products.map((p) => [p.id, p.name] as const),
    ...order.lines.map((l) => [l.productId, l.productName] as const),
  ]);

  async function save() {
    setErr(null);
    try {
      const lines = Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([productId, quantity]) => ({ productId, quantity }));
      if (!lines.length && !window.confirm('No products left: this cancels the order. Continue?'))
        return;
      await put(`/orders/${order.id}/lines`, { lines }, { ifMatch: order.version });
      onDone();
    } catch (e) {
      setErr(e as ApiError);
    }
  }

  return (
    <section className="card">
      <h2>{t('Correct {name}', { name: order.contractor.name })}</h2>
      <p className="muted small" style={{ margin: 0 }}>
        {t('Set 0 to remove a product. The contractor is notified and the change is recorded.')}
      </p>
      <ErrorBox error={err} />
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
      <div className="row wrap">
        <select
          className="input"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          aria-label={t('Add a product')}
        >
          <option value="">{t('Add a product…')}</option>
          {products
            .filter((p) => p.available && !(p.id in qty))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <button
          className="btn ghost"
          disabled={!add}
          onClick={() => {
            setQty({ ...qty, [add]: 1 });
            setAdd('');
          }}
        >
          {t('Add')}
        </button>
      </div>
      <div className="row">
        <button className="btn" onClick={save}>
          {t('Save correction')}
        </button>
        <button className="btn ghost" onClick={onDone}>
          {t('Cancel')}
        </button>
      </div>
    </section>
  );
}
