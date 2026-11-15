'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { type Actor, useSession } from '../lib/session';
import { Icon, Loading } from './ui';

interface Item {
  href: string;
  label: string;
  icon: string;
}

/** Menus follow what each role may use (spec section 2); the server still checks every call. */
export function navFor(actor: Actor | null): Item[] {
  if (actor === 'org_admin')
    return [
      { href: '/app', label: 'Today', icon: 'home' },
      { href: '/app/orders', label: 'Orders', icon: 'orders' },
      { href: '/app/deliveries', label: 'Deliveries', icon: 'deliveries' },
      { href: '/app/shifts', label: 'Shifts', icon: 'shifts' },
      { href: '/app/output', label: 'Output', icon: 'output' },
      { href: '/app/tasks', label: 'Tasks', icon: 'tasks' },
      { href: '/app/products', label: 'Products', icon: 'products' },
      { href: '/app/ingredients', label: 'Ingredients', icon: 'ingredients' },
      { href: '/app/people', label: 'People and teams', icon: 'people' },
      { href: '/app/settings', label: 'Settings', icon: 'settings' },
      { href: '/wall', label: 'Wall screen', icon: 'wall' },
    ];
  if (actor === 'employee')
    return [
      { href: '/app', label: 'Home', icon: 'home' },
      { href: '/app/orders', label: 'Orders', icon: 'orders' },
      { href: '/app/output', label: 'Output', icon: 'output' },
      { href: '/app/shifts', label: 'Shifts', icon: 'shifts' },
      { href: '/app/tasks', label: 'Tasks', icon: 'tasks' },
      { href: '/app/ingredients', label: 'Ingredients', icon: 'ingredients' },
      { href: '/app/settings', label: 'Settings', icon: 'settings' },
    ];
  if (actor === 'contractor_admin')
    return [
      { href: '/app', label: 'Orders', icon: 'orders' },
      { href: '/app/orders/new', label: 'New order', icon: 'products' },
      { href: '/app/deliveries', label: 'Deliveries', icon: 'deliveries' },
      { href: '/app/people', label: 'Admins', icon: 'people' },
      { href: '/app/settings', label: 'Settings', icon: 'settings' },
    ];
  return [];
}

export function Brand({ sub }: { sub?: string }) {
  return (
    <div className="brand">
      <img src="/logo.png" alt="Haydar Inc" />
      <div>
        <b>HAYDAR</b>
        {sub ? <span className="muted small">{sub}</span> : null}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!s.ready) return;
    if (!s.me) router.replace('/login');
    else if (!s.membership) router.replace('/start');
  }, [s.ready, s.me, s.membership, router]);

  if (!s.ready || !s.me || !s.membership) return <Loading />;
  const items = navFor(s.actor);
  const isOn = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));
  const tabs = [...items.slice(0, 4), { href: '/app/more', label: 'More', icon: 'more' }];
  const orgName = s.membership.organization.name;

  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <Brand sub={orgName} />
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={isOn(i.href) ? 'on' : ''}
            aria-current={isOn(i.href) ? 'page' : undefined}
          >
            <Icon name={i.icon} />
            {i.label}
          </Link>
        ))}
        <span className="grow" />
        <Link href="/app/notifications">
          <Icon name="bell" />
          Notifications
        </Link>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            s.signOut();
            router.replace('/login');
          }}
        >
          Sign out
        </button>
      </nav>
      <header className="topbar">
        <img src="/logo.png" alt="Haydar Inc" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <b style={{ font: '800 15px var(--heading)', letterSpacing: 2, color: 'var(--primary)' }}>
            HAYDAR
          </b>
          <span className="muted small">{orgName}</span>
        </div>
        <Link
          href="/app/notifications"
          aria-label="Notifications"
          className="btn ghost"
          style={{ padding: 0, width: 44 }}
        >
          <Icon name="bell" />
        </Link>
      </header>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={isOn(i.href) ? 'on' : ''}
            aria-current={isOn(i.href) ? 'page' : undefined}
          >
            <Icon name={i.icon} size={22} />
            {i.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
