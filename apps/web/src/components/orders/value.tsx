'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { t } from '../../lib/i18n';
import { Icon } from '../ui';

export const won = (n: number) => `₩${n.toLocaleString('en-US')}`;

type Row = { key: string; name: string; detail?: string; amount: number | null };

/**
 * Decided 2026-11-30: what the orders due next are worth, folded into one line until opened so
 * the production board stays clean. Values are estimates at today's price; each delivery records
 * the real amount when it is completed.
 */
export function OrderValuePanel({
  title,
  amount,
  unpriced,
  contractors,
  employees,
  products,
}: {
  title: string;
  amount: number;
  unpriced: number;
  contractors: Row[];
  employees: Row[];
  products: Row[];
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem('manorg.orders.value') === 'open');
    } catch {
      // Storage blocked: start folded.
    }
  }, []);
  function toggle(next: boolean) {
    setOpen(next);
    try {
      window.localStorage.setItem('manorg.orders.value', next ? 'open' : 'closed');
    } catch {
      // Not remembered this time.
    }
  }
  return (
    <details
      className="card value-panel"
      open={open}
      onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <span>{title}</span>
        <b data-testid="orders-value">{won(amount)}</b>
        <span className="muted small">{t('estimate until delivered')}</span>
        {unpriced ? (
          <span className="pill warn">{t('{n} without a price', { n: unpriced })}</span>
        ) : null}
        <span className="value-more">
          {open ? t('Hide details') : t('Details')}
          <Icon name="chevron" size={16} />
        </span>
      </summary>
      <div className="value-grid">
        {contractors.length ? <ValueTable head={t('By contractor')} rows={contractors} /> : null}
        {employees.length ? (
          <ValueTable
            head={t('By employee')}
            rows={employees}
            note={t('A shared product counts in full for each person.')}
          />
        ) : null}
        <ValueTable head={t('By product')} rows={products} />
      </div>
      {unpriced ? (
        <p className="muted small" style={{ margin: 0 }}>
          {t('Products without a price count as ₩0.')}{' '}
          <Link href="/app/products">{t('Set prices in Products')}</Link>
        </p>
      ) : null}
    </details>
  );
}

function ValueTable({ head, rows, note }: { head: string; rows: Row[]; note?: string }) {
  return (
    <div>
      <table className="t">
        <thead>
          <tr>
            <th>{head}</th>
            <th style={{ textAlign: 'right' }}>{t('Amount')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                {r.name}
                {r.detail ? <span className="muted small"> · {r.detail}</span> : null}
              </td>
              <td style={{ textAlign: 'right' }}>{r.amount === null ? '—' : won(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {note ? (
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
