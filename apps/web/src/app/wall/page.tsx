'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { OrdersBoard } from '../../components/orders/board';
import { Loading } from '../../components/ui';
import { formatTime } from '../../lib/api';
import { useSession } from '../../lib/session';
import { t } from '../../lib/i18n';

/** Kitchen TV: big product tiles for the orders due next, refreshed every 30 seconds. */
export default function WallPage() {
  const s = useSession();
  const router = useRouter();
  const [now, setNow] = useState(new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (s.ready && !s.me) router.replace('/');
  }, [s.ready, s.me, router]);
  if (!s.ready || !s.membership) return <Loading />;
  return (
    <main className="wall">
      <header className="row between">
        <div className="row">
          <img
            src="/logo.png"
            alt="Haydar Inc"
            style={{ width: 64, height: 64, objectFit: 'contain' }}
          />
          <div>
            <h1 style={{ fontSize: 34 }}>{t('Orders due next')}</h1>
            <span className="muted">{s.membership.organization.name}</span>
          </div>
        </div>
        <b style={{ font: '800 44px var(--heading)', color: 'var(--primary)' }}>
          {formatTime(now)}
        </b>
      </header>
      <OrdersBoard wall />
    </main>
  );
}
