'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { type Actor, useSession } from '../lib/session';
import { Avatar, Icon, Loading } from './ui';
import { t } from '../lib/i18n';

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
      { href: '/app/finance', label: 'Finance', icon: 'money' },
      { href: '/app/bot', label: 'Bot', icon: 'bot' },
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
      { href: '/app/finance', label: 'Finance', icon: 'money' },
      { href: '/app/people', label: 'Admins', icon: 'people' },
      { href: '/app/settings', label: 'Settings', icon: 'settings' },
    ];
  return [];
}

/** The logo, "HAYDAR SYSTEMS" and the organization's name; a click goes home from anywhere. */
export function Brand({ sub, className = 'brand' }: { sub?: string; className?: string }) {
  return (
    <Link href="/app" className={className} aria-label={t('Home')}>
      <img src="/logo.png" alt="" />
      <span className="brand-text">
        <span className="brand-system">HAYDAR SYSTEMS</span>
        {sub ? <span className="brand-org">{sub}</span> : null}
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!s.ready) return;
    if (!s.me) router.replace('/');
    else if (!s.membership) router.replace('/start');
  }, [s.ready, s.me, s.membership, router]);

  if (!s.ready || !s.me || !s.membership) return <Loading />;
  const items = navFor(s.actor);
  const isOn = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));
  const tabs = [...items.slice(0, 4), { href: '/app/more', label: 'More', icon: 'more' }];
  const orgName = s.membership.organization.name;
  const active = s.me.memberships.filter((m) => m.status === 'active');

  return (
    <div className="shell">
      <nav className="side" aria-label={t('Main')}>
        <Brand sub={orgName} />
        {active.length > 1 ? (
          <select
            className="input org-switch"
            aria-label={t('Switch organization')}
            value={s.orgId ?? ''}
            onChange={(e) => {
              s.chooseOrg(e.target.value);
              router.push('/app');
            }}
          >
            {active.map((m) => (
              <option key={m.organization.id} value={m.organization.id}>
                {m.organization.name}
              </option>
            ))}
          </select>
        ) : null}
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={isOn(i.href) ? 'on' : ''}
            aria-current={isOn(i.href) ? 'page' : undefined}
          >
            <Icon name={i.icon} />
            {t(i.label)}
          </Link>
        ))}
        <span className="grow" />
        <Link href="/app/settings" className={path === '/app/settings' ? 'on' : ''}>
          <Avatar name={s.me.name} url={s.me.avatarUrl} size={28} />
          {s.me.name}
        </Link>
        <Link href="/app/notifications">
          <Icon name="bell" />
          {t('Notifications')}
        </Link>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            s.signOut();
            router.replace('/');
          }}
        >
          {t('Sign out')}
        </button>
      </nav>
      <header className="topbar">
        <Brand sub={orgName} className="brand-top" />
        <Link
          href="/app/notifications"
          aria-label={t('Notifications')}
          className="btn ghost"
          style={{ padding: 0, width: 44 }}
        >
          <Icon name="bell" />
        </Link>
      </header>
      <main className="main">{children}</main>
      <nav className="tabbar" aria-label={t('Main')}>
        {tabs.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={isOn(i.href) ? 'on' : ''}
            aria-current={isOn(i.href) ? 'page' : undefined}
          >
            <Icon name={i.icon} size={22} />
            {t(i.label)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
