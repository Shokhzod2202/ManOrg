'use client';

import { formatDate, type Schemas } from '../../lib/api';
import { t } from '../../lib/i18n';
import { Empty, Icon } from '../ui';

type Screen = Schemas['WallScreen'];
type Total = Screen['totals'][number];
export type WallFace = 'products' | 'list' | 'matrix' | 'overview';

/** Decided 2026-11-28: four ways to look at the orders due next on a shared screen. */
export const WALL_FACES: { key: WallFace; label: string; icon: string }[] = [
  { key: 'products', label: 'Products', icon: 'grid' },
  { key: 'list', label: 'List', icon: 'list' },
  { key: 'matrix', label: 'Matrix', icon: 'matrix' },
  { key: 'overview', label: 'Overview', icon: 'output' },
];

const bySort = (a: Total, b: Total) =>
  a.sortOrder - b.sortOrder || a.productName.localeCompare(b.productName);

export function WallFaces({ face, data }: { face: WallFace; data: Screen }) {
  const totals = [...data.totals].sort(bySort);
  const orders = [...data.orders].sort(
    (a, b) =>
      a.deliveryDate.localeCompare(b.deliveryDate) ||
      (a.approxTime?.start ?? '99').localeCompare(b.approxTime?.start ?? '99') ||
      a.contractor.name.localeCompare(b.contractor.name),
  );
  if (!orders.length) {
    return (
      <Empty>
        {t('No orders are due next. New orders appear here as contractors place them.')}
      </Empty>
    );
  }
  if (face === 'list') return <ListFace totals={totals} orders={orders} />;
  if (face === 'matrix') return <MatrixFace totals={totals} orders={orders} />;
  if (face === 'overview') return <OverviewFace totals={totals} orders={orders} />;
  return <ProductsFace totals={totals} />;
}

function ProductsFace({ totals }: { totals: Total[] }) {
  return (
    <div className="tiles" data-testid="face-products">
      {totals.map((tm) => {
        const pct = tm.quantity
          ? Math.min(100, Math.round((tm.madeQuantity / tm.quantity) * 100))
          : 0;
        return (
          <div
            key={tm.productId}
            className={tm.done ? 'tile done' : tm.madeQuantity > 0 ? 'tile part' : 'tile'}
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
          </div>
        );
      })}
    </div>
  );
}

function ListFace({ totals, orders }: { totals: Total[]; orders: Screen['orders'] }) {
  return (
    <div className="listbox" data-testid="face-list">
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
                    {formatDate(o.deliveryDate)}
                    {o.approxTime ? ` · ${o.approxTime.start}–${o.approxTime.end}` : ''}
                  </span>
                </th>
                {totals.map((tm) => {
                  const l = q.get(tm.productId);
                  return (
                    <td
                      key={tm.productId}
                      className={!l ? 'z' : l.madeQuantity >= l.quantity ? 'made' : ''}
                    >
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
              <td key={tm.productId} className={tm.done ? 'tot made' : 'tot'}>
                {tm.quantity}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MatrixFace({ totals, orders }: { totals: Total[]; orders: Screen['orders'] }) {
  return (
    <div className="card matrix face-matrix" data-testid="face-matrix">
      <table>
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
            <tr key={tm.productId} className={tm.done ? 'done' : undefined}>
              <th scope="row">{tm.productName}</th>
              <td className="tot">{tm.quantity}</td>
              <td className="q">{tm.done ? '✓' : tm.madeQuantity || '·'}</td>
              {orders.map((o) => {
                const l = o.lines.find((x) => x.productId === tm.productId);
                return (
                  <td key={o.orderId} className={l ? 'q' : 'q z'}>
                    {l ? `${l.quantity}${l.madeQuantity >= l.quantity ? ' ✓' : ''}` : '·'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The kitchen at a glance: how much of everything is made, what is still to make (most first),
 * and the deliveries coming up in order.
 */
function OverviewFace({ totals, orders }: { totals: Total[]; orders: Screen['orders'] }) {
  const all = totals.reduce((n, x) => n + x.quantity, 0);
  const made = totals.reduce((n, x) => n + Math.min(x.madeQuantity, x.quantity), 0);
  const pct = all ? Math.round((made / all) * 100) : 0;
  const left = totals
    .map((x) => ({ ...x, left: Math.max(x.quantity - x.madeQuantity, 0) }))
    .filter((x) => x.left > 0)
    .sort((a, b) => b.left - a.left);
  return (
    <div className="overview" data-testid="face-overview">
      <section className="card ov-progress">
        <span className="muted">{t('Made so far')}</span>
        <b className="ov-big">{pct}%</b>
        <span className="bar ov-bar">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="muted">
          {t('{made} of {total} pieces', { made, total: all })} ·{' '}
          {t('{n} of {m} products done', {
            n: totals.filter((x) => x.done).length,
            m: totals.length,
          })}
        </span>
      </section>
      <section className="card">
        <h2>{t('Still to make')}</h2>
        {left.length ? (
          <ul className="ov-left">
            {left.map((x) => (
              <li key={x.productId}>
                <span>{x.productName}</span>
                <b>{x.left}</b>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('Everything is made.')}</Empty>
        )}
      </section>
      <section className="card">
        <h2>{t('Next deliveries')}</h2>
        <ul className="ov-left">
          {orders.map((o) => {
            const q = o.lines.reduce((n, l) => n + l.quantity, 0);
            const m = o.lines.reduce((n, l) => n + Math.min(l.madeQuantity, l.quantity), 0);
            return (
              <li key={o.orderId}>
                <span>
                  <b>{o.contractor.name}</b>
                  <span className="muted small">
                    {' '}
                    · {formatDate(o.deliveryDate)}
                    {o.approxTime ? ` ${o.approxTime.start}–${o.approxTime.end}` : ''}
                  </span>
                </span>
                <span className={m >= q ? 'pill ok' : 'pill'}>
                  {m >= q ? t('Ready') : t('{made} of {total} made', { made: m, total: q })}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
