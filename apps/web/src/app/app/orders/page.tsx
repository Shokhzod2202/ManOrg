'use client';

import { useState } from 'react';
import { ContractorOrders } from '../../../components/home/contractor-orders';
import { OrdersBoard } from '../../../components/orders/board';
import { ErrorBox, Flag, PageHead } from '../../../components/ui';
import { type ApiError, formatDate, post, type Schemas } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useApi } from '../../../lib/use-api';

type Change = Schemas['OrderChangeRequest'];

export default function OrdersPage() {
  const { actor } = useSession();
  if (actor === 'contractor_admin') return <ContractorOrders />;
  return (
    <div className="page wide">
      <PageHead
        title="Orders due next"
        sub="Selected by delivery due; it does not change at midnight."
      />
      <ChangeRequests admin={actor === 'org_admin'} />
      <OrdersBoard />
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
      <h2>Order changes waiting</h2>
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
                    <span className={i.needsAdmin ? 'pill warn' : 'pill blue'}>{KIND[i.kind]}</span>{' '}
                    {i.productName}: {i.fromQuantity} → <b>{i.toQuantity}</b>
                  </span>
                  {can ? (
                    <span className="row">
                      <button className="btn" disabled={busy} onClick={() => decide(i.id, true)}>
                        Accept
                      </button>
                      <button
                        className="btn ghost"
                        disabled={busy}
                        onClick={() => decide(i.id, false)}
                      >
                        Reject
                      </button>
                    </span>
                  ) : (
                    <Flag>Waiting for an admin</Flag>
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </section>
  );
}
