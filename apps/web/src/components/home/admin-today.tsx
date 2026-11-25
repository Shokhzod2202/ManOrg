'use client';

import Link from 'next/link';
import { useSession } from '../../lib/session';
import { MyPunchCard } from './punch-card';
import { formatDate, formatMinutes, formatTime, type Schemas } from '../../lib/api';
import { useApi } from '../../lib/use-api';
import { OrdersBoard } from '../orders/board';
import { Empty, ErrorBox, Flag, Loading, PageHead } from '../ui';
import { flagText, t } from '../../lib/i18n';

type Today = Schemas['TodayDashboard'];
interface DeliveryRow {
  id: string;
  contractor: { id: string; name: string };
  status: string;
  windowStart: string | null;
  windowEnd: string | null;
}
interface TaskRow {
  id: string;
  title: string;
  type: string;
  dueDate: string | null;
}
interface TotalRow {
  productId: string;
  name: string;
  quantity: number;
}

const STATUS: Record<string, string> = {
  not_started: 'Not started',
  draft: 'Draft',
  completed: 'Waiting for contractor',
  confirmed: 'Confirmed',
  change_requested: 'Change requested',
};

/** DSH-1: everything an admin needs today on one screen, refreshed every 30 seconds. */
export function AdminToday() {
  const { membership } = useSession();
  const { data, error, loading, reload } = useApi<Today>('/dashboard/today', 30_000);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const w = data.waiting;
  const waiting = [
    { n: w.applications ?? 0, label: 'Applications', href: '/app/people' },
    { n: w.punchChangeRequests ?? 0, label: 'Punch change requests', href: '/app/shifts' },
    { n: w.orderChangeRequests ?? 0, label: 'Order changes', href: '/app/orders' },
    { n: w.deliveryChangeRequests ?? 0, label: 'Delivery changes', href: '/app/deliveries' },
    { n: w.ingredientOrders ?? 0, label: 'Ingredient orders', href: '/app/tasks' },
  ];
  const deliveries = data.deliveriesToday as unknown as DeliveryRow[];
  const tasks = (data.tasks.due ?? []) as unknown as TaskRow[];
  const output = data.outputTotals as unknown as TotalRow[];

  return (
    <div className="page wide">
      <PageHead title={t('Today')} sub={formatDate(data.today)} />
      <ErrorBox error={error} onRetry={reload} />
      {membership?.worksShifts ? <MyPunchCard /> : null}
      <div className="kpis">
        <div className="kpi">
          <b>{data.onShift.length}</b>
          <span>{t('On shift now')}</span>
        </div>
        {waiting.map((k) => (
          <Link key={k.href} className="kpi" href={k.href}>
            <b>{k.n}</b>
            <span>{t(k.label)}</span>
          </Link>
        ))}
      </div>
      <section className="stack">
        <h2 className="center">{t('Orders due next')}</h2>
        <OrdersBoard />
      </section>
      <div className="grid2">
        <section className="card">
          <h2>{t('On shift')}</h2>
          {data.onShift.length ? (
            <table className="t cards">
              <thead>
                <tr>
                  <th>{t('Name')}</th>
                  <th>{t('Status')}</th>
                  <th>{t('Since')}</th>
                  <th>{t('Worked')}</th>
                </tr>
              </thead>
              <tbody>
                {data.onShift.map((p) => (
                  <tr key={p.employee?.id}>
                    <td data-label={t('Name')}>
                      <b>{p.employee?.name}</b>
                      {p.employee?.title ? (
                        <span className="muted small"> · {p.employee.title}</span>
                      ) : null}
                    </td>
                    <td data-label={t('Status')}>
                      <span className={p.status === 'working' ? 'pill ok' : 'pill warn'}>
                        {p.status === 'working' ? t('Working') : t('Paused')}
                      </span>
                    </td>
                    <td data-label={t('Since')}>{formatTime(p.startedAt)}</td>
                    <td data-label={t('Worked')}>{formatMinutes(p.workedMinutes ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{t('Nobody is on shift.')}</Empty>
          )}
          {data.flags.length ? (
            <div className="stack">
              <b>{t('Needs a look')}</b>
              {data.flags.map((f) => (
                <div key={f.employee?.id} className="row wrap">
                  <b>{f.employee?.name}</b>
                  {f.flags?.map((x) => (
                    <Flag key={x.code}>{flagText(x)}</Flag>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </section>
        <section className="card">
          <h2>{t('Deliveries today')}</h2>
          {deliveries.length ? (
            <table className="t cards">
              <thead>
                <tr>
                  <th>{t('Contractor')}</th>
                  <th>{t('Time')}</th>
                  <th>{t('Status')}</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td data-label={t('Contractor')}>
                      <Link href={`/app/deliveries?contractor=${d.contractor.id}`}>
                        <b>{d.contractor.name}</b>
                      </Link>
                    </td>
                    <td data-label={t('Time')}>
                      {d.windowStart
                        ? `${formatTime(d.windowStart)}–${formatTime(d.windowEnd)}`
                        : '—'}
                    </td>
                    <td data-label={t('Status')}>
                      <span
                        className={
                          d.status === 'confirmed'
                            ? 'pill ok'
                            : d.status === 'change_requested'
                              ? 'pill warn'
                              : 'pill'
                        }
                      >
                        {t(STATUS[d.status] ?? d.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{t('No deliveries started today.')}</Empty>
          )}
        </section>
        <section className="card">
          <h2>{t('Tasks due')}</h2>
          <span className="muted small">
            {data.tasks.doneLast24h ?? 0} done in the last 24 hours
          </span>
          {tasks.length ? (
            tasks.map((t) => (
              <Link key={t.id} href="/app/tasks" className="row between">
                <span>{t.title}</span>
                <span className="muted small">{t.dueDate ? formatDate(t.dueDate) : ''}</span>
              </Link>
            ))
          ) : (
            <Empty>{t('No open tasks due.')}</Empty>
          )}
        </section>
        <section className="card">
          <h2>{t('Output today')}</h2>
          {output.length ? (
            <table className="t">
              <tbody>
                {output.map((o) => (
                  <tr key={o.productId}>
                    <td>{o.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      <b>{o.quantity}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{t('No output logged yet today.')}</Empty>
          )}
        </section>
      </div>
    </div>
  );
}
