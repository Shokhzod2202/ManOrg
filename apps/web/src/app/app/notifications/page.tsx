'use client';

import { Empty, ErrorBox, Loading, PageHead } from '../../../components/ui';
import { formatDate, formatTime, post, type Schemas } from '../../../lib/api';
import { useApi } from '../../../lib/use-api';

type N = Schemas['Notification'];

const TEXT: Record<string, string> = {
  'task.assigned': 'You have a new task.',
  'task.completed': 'A task was finished with a photo.',
  'application.created': 'Someone applied to join.',
  'ingredient.ordered': 'An ingredient order was requested.',
  'ingredient.fulfilled': 'An ingredient order was bought.',
  'ingredient.due': 'An ingredient is due to be ordered today.',
  'order.edited': 'An order was changed.',
  'delivery.completed': 'A delivery is waiting for your confirmation.',
  'delivery.change_requested': 'A contractor asked to change a delivery.',
  'delivery.approx_time_changed': 'The delivery time changed.',
  'delivery.change_approved': 'Your delivery change was approved.',
  'delivery.change_rejected': 'Your delivery change was not approved.',
  'order.change_accepted': 'Your order change was accepted.',
  'order.change_rejected': 'Your order change was not accepted.',
  'application.approved': 'Your application was approved.',
  'application.rejected': 'Your application was not approved.',
};

export default function NotificationsPage() {
  const { data, error, loading, reload } = useApi<{ items: N[] }>('/notifications', 60_000);
  async function read(id: string) {
    await post(`/notifications/${id}/read`).catch(() => undefined);
    reload();
  }
  return (
    <div className="page">
      <PageHead title="Notifications" />
      {loading && !data ? <Loading /> : null}
      <ErrorBox error={error} onRetry={reload} />
      {data && !data.items.length ? <Empty>No notifications.</Empty> : null}
      {data?.items.map((n) => (
        <div
          key={n.id}
          className="card"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: n.readAt ? '#fff' : 'var(--soft)',
          }}
        >
          <span>
            <b>{TEXT[n.type] ?? n.type}</b>
            <br />
            <span className="muted small">
              {formatDate(n.createdAt.slice(0, 10))} {formatTime(n.createdAt)}
            </span>
          </span>
          {!n.readAt ? (
            <button className="btn ghost" onClick={() => read(n.id)}>
              Mark read
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
