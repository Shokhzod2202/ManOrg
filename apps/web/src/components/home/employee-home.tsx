'use client';

import Link from 'next/link';
import { formatDate, type Schemas } from '../../lib/api';
import { useApi } from '../../lib/use-api';
import { OrdersBoard } from '../orders/board';
import { Empty, ErrorBox, Loading, PageHead } from '../ui';
import { PunchCard } from './punch-card';

type Home = Schemas['EmployeeHome'];
interface TaskRow {
  id: string;
  title: string;
  dueDate: string | null;
}

/** DSH-2: punch card first, then my orders, output and tasks. */
export function EmployeeHome() {
  const { data, error, loading, reload } = useApi<Home>('/dashboard/home', 30_000);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorBox error={error} onRetry={reload} />;
  const tasks = data.tasks as unknown as TaskRow[];
  return (
    <div className="page">
      <PageHead title="Home" sub={formatDate(data.today)} />
      <ErrorBox error={error} onRetry={reload} />
      <PunchCard card={data.punchCard} onChange={reload} />
      {data.unreadNotifications ? (
        <Link href="/app/notifications" className="alert">
          {data.unreadNotifications} new notification{data.unreadNotifications === 1 ? '' : 's'}
        </Link>
      ) : null}
      {data.myOrders ? (
        <section className="stack">
          <h2 className="center">Orders due next</h2>
          <OrdersBoard />
        </section>
      ) : null}
      <div className="grid2">
        <section className="card">
          <div className="row between">
            <h2>My output today</h2>
            <Link href="/app/output">Log output</Link>
          </div>
          {data.output.personal.length || data.output.team.length ? (
            <table className="t">
              <tbody>
                {data.output.personal.map((l) => (
                  <tr key={l.productId}>
                    <td>{l.name}</td>
                    <td style={{ textAlign: 'right' }}>
                      <b>{l.quantity}</b>
                    </td>
                  </tr>
                ))}
                {data.output.team.map((l) => (
                  <tr key={`${l.team.id}${l.productId}`}>
                    <td>
                      {l.name} <span className="muted small">· {l.team.name}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <b>{l.quantity}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Nothing logged yet today.</Empty>
          )}
        </section>
        <section className="card">
          <div className="row between">
            <h2>My tasks</h2>
            <Link href="/app/tasks">All tasks</Link>
          </div>
          {tasks.length ? (
            tasks.map((t) => (
              <Link key={t.id} href="/app/tasks" className="row between">
                <span>{t.title}</span>
                <span className="muted small">
                  {t.dueDate ? formatDate(t.dueDate.slice(0, 10)) : ''}
                </span>
              </Link>
            ))
          ) : (
            <Empty>No open tasks. Well done.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}
