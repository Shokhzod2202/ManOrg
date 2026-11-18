'use client';

import { useState } from 'react';
import { ContractorOrders } from '../../../components/home/contractor-orders';
import { OrdersBoard } from '../../../components/orders/board';
import { OrdersByDay } from '../../../components/orders/by-day';
import { ErrorBox, Flag, PageHead } from '../../../components/ui';
import { type ApiError, formatDate, post, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';
import { t } from '../../../lib/i18n';

type Change = Schemas['OrderChangeRequest'];

export default function OrdersPage() {
  const { actor } = useSession();
  const [tab, setTab] = useState<'next' | 'day'>('next');
  if (actor === 'contractor_admin') return <ContractorOrders />;
  const admin = actor === 'org_admin';
  return (
    <div className="page wide">
      <PageHead
        title={tab === 'next' ? t('Orders due next') : t('Orders by day')}
        sub={
          tab === 'next'
            ? t('Selected by delivery due; it does not change at midnight.')
            : undefined
        }
      >
        {admin ? (
          <div className="tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'next'}
              className={tab === 'next' ? 'on' : ''}
              onClick={() => setTab('next')}
            >
              {t('Due next')}
            </button>
            <button
              role="tab"
              aria-selected={tab === 'day'}
              className={tab === 'day' ? 'on' : ''}
              onClick={() => setTab('day')}
            >
              {t('By day')}
            </button>
          </div>
        ) : null}
      </PageHead>
      <ChangeRequests admin={admin} />
      {tab === 'next' ? <OrdersBoard /> : <OrdersByDay canEdit={admin} />}
    </div>
  );
}

const KIND = { add: 'Add', increase: 'More', decrease: 'Less', remove: 'Remove' } as const;

/** Contractor change requests, per product: staff accept additions; only admins take decreases. */
function ChangeRequests({ admin }: { admin: boolean }) {
  const { data, error, reload } = useApi<{ items: Change[] }>(
    '/order-change-requests?status=open',
    30_000,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  if (error) return null;
  if (!data?.items.length) return null;

  async function decide(id: string, ok: boolean) {
    setBusy(true);
    setErr(null);
    try {
      await post(`/order-change-items/${id}/${ok ? 'accept' : 'reject'}`);
      reload();
    } catch (e) {
      setErr(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{t('Order changes waiting')}</h2>
      <ErrorBox error={err} />
      {data.items.map((c) => (
        <div
          key={c.id}
          className="stack"
          style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}
        >
          <div className="row between wrap">
            <b>
              {c.contractor.name} · {formatDate(c.deliveryDate)}
            </b>
            {c.note ? <span className="muted small">“{c.note}”</span> : null}
          </div>
          {c.items
            .filter((i) => i.status === 'pending')
            .map((i) => {
              const can = admin || !i.needsAdmin;
              return (
                <div key={i.id} className="row between wrap">
                  <span>
                    <span className={i.needsAdmin ? 'pill warn' : 'pill blue'}>
                      {t(KIND[i.kind])}
                    </span>{' '}
                    {i.productName}: {i.fromQuantity} → <b>{i.toQuantity}</b>
                  </span>
                  {can ? (
                    <span className="row">
                      <button className="btn" disabled={busy} onClick={() => decide(i.id, true)}>
                        {t('Accept')}
                      </button>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() => decide(i.id, false)}
                      >
                        {t('Reject')}
                      </button>
                    </span>
                  ) : (
                    <Flag>{t('Waiting for an admin')}</Flag>
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </section>
  );
}
