'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { navFor } from '../../../components/shell';
import { Icon, PageHead } from '../../../components/ui';
import { useSession } from '../../../lib/session';

/** The phone tab bar shows four places; everything else is here. */
export default function MorePage() {
  const s = useSession();
  const router = useRouter();
  const items = navFor(s.actor).slice(4);
  return (
    <div className="page">
      <PageHead title="More" />
      <div className="card" style={{ padding: 6 }}>
        {[...items, { href: '/app/notifications', label: 'Notifications', icon: 'bell' }].map(
          (i) => (
            <Link
              key={i.href}
              href={i.href}
              className="row"
              style={{
                minHeight: 52,
                padding: '0 12px',
                textDecoration: 'none',
                color: 'var(--ink)',
                borderBottom: '1px solid #f1f3f8',
              }}
            >
              <Icon name={i.icon} />
              {i.label}
            </Link>
          ),
        )}
      </div>
      <button
        className="btn ghost"
        onClick={() => {
          s.signOut();
          router.replace('/login');
        }}
      >
        Sign out
      </button>
    </div>
  );
}
