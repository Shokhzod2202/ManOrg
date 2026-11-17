'use client';

import { useEffect, useState } from 'react';
import { type ApiError, formatDate, post, type Schemas } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/use-api';
import { Empty, ErrorBox, Icon, Loading } from '../ui';

type DueNext = Schemas['DueNextOrders'];
type View = 'list' | 'matrix' | 'products';

const VIEWS: { key: View; label: string; icon: string }[] = [
  { key: 'list', label: 'List', icon: 'list' },
  { key: 'matrix', label: 'Matrix', icon: 'matrix' },
  { key: 'products', label: 'Products', icon: 'grid' },
];

/**
 * Orders due next (TOD-1 to TOD-7): selected by delivery due, so the list does not change at
 * midnight. Three views; the chosen one is saved on the person's account.
 */
export function OrdersBoard({
  refreshMs = 30_000,
  wall = false,
}: {
  refreshMs?: number;
  wall?: boolean;
}) {
  const s = useSession();
  const admin = s.actor === 'org_admin';
  // TOD-3, TOD-5, TOD-6: everything, one employee's assigned products, or one contractor.
  const [who, setWho] = useState<string>('all');
  const [contractor, setContractor] = useState<string>('');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('manorg.orders.who');
      if (saved) setWho(saved);
    } catch {
      // Storage blocked: start with everything.
    }
  }, []);
  function choose(next: string) {
    setWho(next);
    try {
      window.localStorage.setItem('manorg.orders.who', next);
    } catch {
      // Not remembered this time.
    }
  }
  const members = useApi<{ items: Schemas['Member'][] }>(admin && !wall ? '/members' : null);
  const employees = (members.data?.items ?? []).filter(
    (m) => m.role === 'employee' && m.status === 'active',
  );
  // An employee can only ever ask for their own products.
  const target = admin || who === 'all' ? who : (s.me?.id ?? 'all');
  const path =
    wall || target === 'all' ? '/orders/due-next' : `/employees/${target}/orders/due-next`;
  const { data, error, loading, reload } = useApi<DueNext>(path, refreshMs);
  const [busy, setBusy] = useState<string | null>(null);
  const [markError, setMarkError] = useState<ApiError | null>(null);
  const view: View = wall ? 'products' : (s.me?.preferences?.ordersView ?? 'products');

  async function mark(productId: string, made: boolean, contractorId?: string) {
    setBusy(`${productId}:${contractorId ?? ''}`);
    setMarkError(null);
    try {
      await post('/orders/due-next/made', {
        productId,
        made,
        ...(contractorId ? { contractorId } : {}),
      });
      reload();
    } catch (e) {
      setMarkError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const allOrders = data.orders;
  const contractors = [...new Map(allOrders.map((o) => [o.contractor.id, o.contractor])).values()];
  const picked = contractor && contractors.some((c) => c.id === contractor) ? contractor : '';
  const shownOrders = picked ? allOrders.filter((o) => o.contractor.id === picked) : allOrders;
  // One contractor: totals are that contractor's lines, so ticks and counts stay honest.
  const baseTotals = picked
    ? [
        ...shownOrders
          .flatMap((o) => o.lines)
          .reduce((m, l) => {
            const t = m.get(l.productId) ?? {
              productId: l.productId,
              productName: l.productName,
              quantity: 0,
              madeQuantity: 0,
              done: false,
            };
            t.quantity += l.quantity;
            t.madeQuantity += l.madeQuantity;
            t.done = t.madeQuantity >= t.quantity;
            return m.set(l.productId, t);
          }, new Map<string, Schemas['ProductTotal']>())
          .values(),
      ]
    : data.totals;
  const totals = [...baseTotals].sort((a, b) => a.productName.localeCompare(b.productName));
  const orders = [...shownOrders].sort(
    (a, b) =>
      (a.approxTime?.start ?? '99').localeCompare(b.approxTime?.start ?? '99') ||
      a.contractor.name.localeCompare(b.contractor.name),
  );
  const dates = [...new Set(orders.map((o) => o.deliveryDate))];
  const units = totals.reduce((n, t) => n + t.quantity, 0);
  const doneCount = totals.filter((t) => t.done).length;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {!wall ? (
        <div className="viewbar">
          <span className="muted">
            {dates.length ? `For ${dates.map(formatDate).join(', ')}` : 'Nothing due'} ·{' '}
            {orders.length} contractors · {units} items · {doneCount}/{totals.length} made
          </span>
          <div className="tabs" role="tablist" aria-label="View">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                className={view === v.key ? 'on' : ''}
                onClick={() => void s.setOrdersView(v.key)}
              >
                <Icon name={v.icon} size={16} />
                {v.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!wall ? (
        <div className="viewbar">
          {admin ? (
            <select
              className="input"
              value={who}
              onChange={(e) => choose(e.target.value)}
              aria-label="Whose products"
            >
              <option value="all">All products</option>
              {employees.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}'s products
                </option>
              ))}
            </select>
          ) : (
            <div className="tabs" role="tablist" aria-label="Whose products">
              <button
                role="tab"
                aria-selected={who === 'all'}
                className={who === 'all' ? 'on' : ''}
                onClick={() => choose('all')}
              >
                All
              </button>
              <button
                role="tab"
                aria-selected={who !== 'all'}
                className={who !== 'all' ? 'on' : ''}
                onClick={() => s.me && choose(s.me.id)}
              >
                Mine
              </button>
            </div>
          )}
          {contractors.length > 1 || picked ? (
            <select
              className="input"
              value={picked}
              onChange={(e) => setContractor(e.target.value)}
              aria-label="Contractor"
            >
              <option value="">All contractors</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}
      <ErrorBox error={markError} />
      {!orders.length ? (
        <Empty>No orders are due next. New orders appear here as contractors place them.</Empty>
      ) : view === 'products' ? (
        <div className="tiles">
          {totals.map((t) => {
            const pct = t.quantity
              ? Math.min(100, Math.round((t.madeQuantity / t.quantity) * 100))
              : 0;
            const cls = t.done ? 'tile done' : t.madeQuantity > 0 ? 'tile part' : 'tile';
            return (
              <button
                key={t.productId}
                type="button"
                className={cls}
                disabled={busy !== null || wall}
                onClick={() => mark(t.productId, !t.done)}
                aria-pressed={t.done}
                title={t.done ? 'Made. Tap to undo.' : 'Tap when made'}
              >
                <span className="tn">{t.productName}</span>
                <span className="tq">{t.quantity}</span>
                <span className="st">
                  {t.done ? (
                    <>
                      <Icon name="check" size={14} /> Made
                    </>
                  ) : t.madeQuantity > 0 ? (
                    `${t.madeQuantity} of ${t.quantity} made`
                  ) : (
                    'To make'
                  )}
                </span>
                <span className="bar">
                  <span style={{ width: `${pct}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      ) : view === 'list' ? (
        <div className="listbox">
          <table className="list">
            <thead>
              <tr>
                <th className="who">Contractor</th>
                {totals.map((t) => (
                  <th key={t.productId} className="ph" scope="col">
                    <span>{t.productName}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const q = new Map(o.lines.map((l) => [l.productId, l]));
                return (
                  <tr key={o.orderId}>
                    <th className="who" scope="row">
                      <b>{o.contractor.name}</b>
                      <span>
                        {o.approxTime ? `${o.approxTime.start}–${o.approxTime.end}` : 'No time set'}
                      </span>
                    </th>
                    {totals.map((t) => {
                      const l = q.get(t.productId);
                      return (
                        <td key={t.productId} className={l ? '' : 'z'}>
                          {l ? l.quantity : '·'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr className="total">
                <th className="who" scope="row">
                  <b>Total</b>
                </th>
                {totals.map((t) => (
                  <td key={t.productId} className="tot">
                    {t.quantity}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="who" scope="row">
                  <b>Made</b>
                </th>
                {totals.map((t) => (
                  <td key={t.productId}>
                    <MadeTick
                      done={t.done}
                      part={t.madeQuantity > 0}
                      disabled={busy !== null}
                      label={t.productName}
                      onClick={() => mark(t.productId, !t.done)}
                    />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table className="matrix" style={{ display: 'table' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Product</th>
                <th>Total</th>
                <th>Made</th>
                {orders.map((o) => (
                  <th key={o.orderId}>{o.contractor.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals.map((t) => (
                <tr key={t.productId}>
                  <th scope="row">{t.productName}</th>
                  <td className="tot">{t.quantity}</td>
                  <td className="q">
                    <MadeTick
                      done={t.done}
                      part={t.madeQuantity > 0}
                      disabled={busy !== null}
                      label={t.productName}
                      onClick={() => mark(t.productId, !t.done)}
                    />
                  </td>
                  {orders.map((o) => {
                    const l = o.lines.find((x) => x.productId === t.productId);
                    return (
                      <td key={o.orderId} className={l ? 'q' : 'q z'}>
                        {l ? (
                          <span className="row" style={{ justifyContent: 'center', gap: 6 }}>
                            {l.quantity}
                            <MadeTick
                              small
                              done={l.madeQuantity >= l.quantity}
                              part={l.madeQuantity > 0}
                              disabled={busy !== null}
                              label={`${t.productName} for ${o.contractor.name}`}
                              onClick={() =>
                                mark(t.productId, l.madeQuantity < l.quantity, o.contractor.id)
                              }
                            />
                          </span>
                        ) : (
                          '·'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MadeTick({
  done,
  part,
  disabled,
  label,
  onClick,
  small,
}: {
  done: boolean;
  part: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={done ? 'mk done' : part ? 'mk part' : 'mk'}
      style={small ? { width: 24, height: 24 } : undefined}
      aria-pressed={done}
      aria-label={done ? `${label}: made. Undo` : `Mark ${label} made`}
      disabled={disabled}
      onClick={onClick}
    >
      {done ? <Icon name="check" size={small ? 14 : 18} stroke={3} /> : null}
    </button>
  );
}
