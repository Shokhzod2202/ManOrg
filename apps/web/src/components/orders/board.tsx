'use client';

import { useEffect, useState } from 'react';
import { type ApiError, formatDate, post, type Schemas } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useApi } from '../../lib/use-api';
import { Empty, ErrorBox, Icon, Loading } from '../ui';
import { t } from '../../lib/i18n';

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
            const tm = m.get(l.productId) ?? {
              productId: l.productId,
              productName: l.productName,
              quantity: 0,
              madeQuantity: 0,
              done: false,
            };
            tm.quantity += l.quantity;
            tm.madeQuantity += l.madeQuantity;
            tm.done = tm.madeQuantity >= tm.quantity;
            return m.set(l.productId, tm);
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
  const units = totals.reduce((n, tm) => n + tm.quantity, 0);
  const doneCount = totals.filter((tm) => tm.done).length;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {!wall ? (
        <div className="viewbar">
          <span className="muted">
            {dates.length
              ? t('For {dates}', { dates: dates.map(formatDate).join(', ') })
              : t('Nothing due')}{' '}
            ·{' '}
            {t('{orders} contractors · {units} items · {done}/{total} made', {
              orders: orders.length,
              units,
              done: doneCount,
              total: totals.length,
            })}
          </span>
          <div className="tabs" role="tablist" aria-label={t('View')}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                className={view === v.key ? 'on' : ''}
                onClick={() => void s.setOrdersView(v.key)}
              >
                <Icon name={v.icon} size={16} />
                {t(v.label)}
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
              aria-label={t('Whose products')}
            >
              <option value="all">{t('All products')}</option>
              {employees.map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name}'s products
                </option>
              ))}
            </select>
          ) : (
            <div className="tabs" role="tablist" aria-label={t('Whose products')}>
              <button
                role="tab"
                aria-selected={who === 'all'}
                className={who === 'all' ? 'on' : ''}
                onClick={() => choose('all')}
              >
                {t('All')}
              </button>
              <button
                role="tab"
                aria-selected={who !== 'all'}
                className={who !== 'all' ? 'on' : ''}
                onClick={() => s.me && choose(s.me.id)}
              >
                {t('Mine')}
              </button>
            </div>
          )}
          {contractors.length > 1 || picked ? (
            <select
              className="input"
              value={picked}
              onChange={(e) => setContractor(e.target.value)}
              aria-label={t('Contractor')}
            >
              <option value="">{t('All contractors')}</option>
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
        <Empty>
          {t('No orders are due next. New orders appear here as contractors place them.')}
        </Empty>
      ) : view === 'products' ? (
        <div className="tiles">
          {totals.map((tm) => {
            const pct = tm.quantity
              ? Math.min(100, Math.round((tm.madeQuantity / tm.quantity) * 100))
              : 0;
            const cls = tm.done ? 'tile done' : tm.madeQuantity > 0 ? 'tile part' : 'tile';
            return (
              <button
                key={tm.productId}
                type="button"
                className={cls}
                disabled={busy !== null || wall}
                onClick={() => mark(tm.productId, !tm.done)}
                aria-pressed={tm.done}
                title={tm.done ? t('Made. Tap to undo.') : t('Tap when made')}
              >
                <span className="tn">{tm.productName}</span>
                <span className="tq">{tm.quantity}</span>
                <span className="st">
                  {tm.done ? (
                    <>
                      <Icon name="check" size={14} /> {t('Made')}
                    </>
                  ) : tm.madeQuantity > 0 ? (
                    t('{made} of {total} made', { made: tm.madeQuantity, total: tm.quantity })
                  ) : (
                    t('To make')
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
                <th className="who">{t('Contractor')}</th>
                {totals.map((tm) => (
                  <th key={tm.productId} className="ph" scope="col">
                    <span>{tm.productName}</span>
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
                        {o.approxTime
                          ? `${o.approxTime.start}–${o.approxTime.end}`
                          : t('No time set')}
                      </span>
                    </th>
                    {totals.map((tm) => {
                      const l = q.get(tm.productId);
                      return (
                        <td key={tm.productId} className={l ? '' : 'z'}>
                          {l ? l.quantity : '·'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr className="total">
                <th className="who" scope="row">
                  <b>{t('Total')}</b>
                </th>
                {totals.map((tm) => (
                  <td key={tm.productId} className="tot">
                    {tm.quantity}
                  </td>
                ))}
              </tr>
              <tr>
                <th className="who" scope="row">
                  <b>{t('Made')}</b>
                </th>
                {totals.map((tm) => (
                  <td key={tm.productId}>
                    <MadeTick
                      done={tm.done}
                      part={tm.madeQuantity > 0}
                      disabled={busy !== null}
                      label={tm.productName}
                      onClick={() => mark(tm.productId, !tm.done)}
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
                <th style={{ textAlign: 'left' }}>{t('Product')}</th>
                <th>{t('Total')}</th>
                <th>{t('Made')}</th>
                {orders.map((o) => (
                  <th key={o.orderId}>{o.contractor.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {totals.map((tm) => (
                <tr key={tm.productId}>
                  <th scope="row">{tm.productName}</th>
                  <td className="tot">{tm.quantity}</td>
                  <td className="q">
                    <MadeTick
                      done={tm.done}
                      part={tm.madeQuantity > 0}
                      disabled={busy !== null}
                      label={tm.productName}
                      onClick={() => mark(tm.productId, !tm.done)}
                    />
                  </td>
                  {orders.map((o) => {
                    const l = o.lines.find((x) => x.productId === tm.productId);
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
                              label={t('{product} for {contractor}', {
                                product: tm.productName,
                                contractor: o.contractor.name,
                              })}
                              onClick={() =>
                                mark(tm.productId, l.madeQuantity < l.quantity, o.contractor.id)
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
