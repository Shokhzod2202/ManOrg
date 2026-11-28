'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type Actor, useSession } from '../lib/session';
import { Avatar, Icon, Loading } from './ui';
import { t } from '../lib/i18n';

interface Item {
  href: string;
  label: string;
  icon: string;
}

/** Menus follow what each role may use (spec section 2); the server still checks every call. */
export function navFor(actor: Actor | null, provider = true): Item[] {
  if (actor === 'org_admin')
    return [
      { href: '/app', label: 'Today', icon: 'home' },
      { href: '/app/orders', label: 'Orders', icon: 'orders' },
      { href: '/app/deliveries', label: 'Deliveries', icon: 'deliveries' },
      { href: '/app/shifts', label: 'Shifts', icon: 'shifts' },
      // Decided 2026-11-30: worked hours and advances; first in More on phones.
      { href: '/app/hours', label: 'Work hours', icon: 'clock' },
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
      // A contractor's employees see no orders (decided 2026-11-29).
      ...(provider ? [{ href: '/app/orders', label: 'Orders', icon: 'orders' }] : []),
      { href: '/app/output', label: 'Output', icon: 'output' },
      { href: '/app/shifts', label: 'Shifts', icon: 'shifts' },
      { href: '/app/hours', label: 'Work hours', icon: 'clock' },
      // Decided 2026-11-28: their own output, day by day.
      { href: '/app/output-history', label: 'Output history', icon: 'list' },
      { href: '/app/tasks', label: 'Tasks', icon: 'tasks' },
      { href: '/app/ingredients', label: 'Ingredients', icon: 'ingredients' },
      { href: '/app/settings', label: 'Settings', icon: 'settings' },
    ];
  if (actor === 'contractor_admin')
    return [
      { href: '/app', label: 'Orders', icon: 'orders' },
      { href: '/app/orders/new', label: 'New order', icon: 'products' },
      { href: '/app/deliveries', label: 'Deliveries', icon: 'deliveries' },
      // Decided 2026-11-29: contractors run their own staff, products and ingredients too.
      { href: '/app/today', label: 'Today', icon: 'home' },
      { href: '/app/shifts', label: 'Shifts', icon: 'shifts' },
      { href: '/app/hours', label: 'Work hours', icon: 'clock' },
      { href: '/app/output', label: 'Output', icon: 'output' },
      { href: '/app/tasks', label: 'Tasks', icon: 'tasks' },
      { href: '/app/products', label: 'Products', icon: 'products' },
      { href: '/app/ingredients', label: 'Ingredients', icon: 'ingredients' },
      { href: '/app/people', label: 'People and teams', icon: 'people' },
      { href: '/app/finance', label: 'Finance', icon: 'money' },
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

  // A page this role cannot use (for example after being made an employee) goes back home.
  useEffect(() => {
    if (!s.ready || !s.membership) return;
    const allowed = [
      ...navFor(s.actor, s.provider).map((i) => i.href),
      '/app/notifications',
      '/app/more',
      '/app/settings',
    ];
    const ok = allowed.some((h) => (h === '/app' ? path === '/app' : path.startsWith(h)));
    if (!ok) router.replace('/app');
  }, [s.ready, s.membership, s.actor, path, router]);

  if (!s.ready || !s.me || !s.membership) return <Loading />;
  const items = navFor(s.actor, s.provider);
  const isOn = (href: string) => (href === '/app' ? path === '/app' : path.startsWith(href));
  const tabs = [...items.slice(0, 4), { href: '/app/more', label: 'More', icon: 'more' }];
  const orgName = s.membership.organization.name;

  return (
    <div className="shell">
      <nav className="side" aria-label={t('Main')}>
        <div className="brand-row side-brand">
          <Brand sub={orgName} />
          <OrgSwitch />
        </div>
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
          {/* The name this organization gave you, else your account name (2026-11-29). */}
          {s.membership.displayName || s.me.name}
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
        <div className="brand-row">
          <Brand sub={orgName} className="brand-top" />
          <OrgSwitch />
        </div>
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

/**
 * Decided 2026-11-29: a small ▾ beside the organization's name on every page; it lists the
 * organizations the person belongs to and switches with one tap. Hidden with only one.
 */
function OrgSwitch() {
  const s = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const active = s.me?.memberships.filter((m) => m.status === 'active') ?? [];
  if (active.length < 2) return null;
  return (
    <span className="org-pick" ref={box}>
      <button
        type="button"
        className={open ? 'org-pick-btn on' : 'org-pick-btn'}
        aria-label={t('Switch organization')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron" size={18} />
      </button>
      {open ? (
        <span className="org-pick-list" role="menu" aria-label={t('Switch organization')}>
          {active.map((m) => {
            const here = m.organization.id === s.orgId;
            return (
              <button
                key={m.organization.id}
                type="button"
                role="menuitemradio"
                aria-checked={here}
                className={here ? 'here' : ''}
                onClick={() => {
                  setOpen(false);
                  if (here) return;
                  s.chooseOrg(m.organization.id);
                  router.push('/app');
                }}
              >
                <span className="org-pick-name">
                  <b>{m.organization.name}</b>
                  <span className="muted small">
                    {t(m.role === 'admin' ? 'Admin' : 'Employee')} ·{' '}
                    {m.organization.type === 'contractor' ? t('Contractor') : t('Organization')}
                  </span>
                </span>
                {here ? <Icon name="check" size={18} /> : null}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
