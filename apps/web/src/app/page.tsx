'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Icon, Loading } from '../components/ui';
import { useSession } from '../lib/session';

const POINTS = [
  {
    icon: 'shifts',
    title: 'Shifts and punch card',
    text: 'Start, pause and end with one tap. Hours, late starts and missing punches show up on their own.',
  },
  {
    icon: 'orders',
    title: 'Orders due next',
    text: 'Every contractor’s order in one list, matrix or tile view, with Made ticks the whole kitchen can see.',
  },
  {
    icon: 'deliveries',
    title: 'Deliveries',
    text: 'Record what was delivered, keep the ordered numbers, and let contractors confirm.',
  },
  {
    icon: 'tasks',
    title: 'Tasks with photo proof',
    text: 'Assign a task; it is done when a photo is taken with the camera.',
  },
  {
    icon: 'output',
    title: 'Daily output',
    text: 'Personal and team output next to hours worked, per product.',
  },
  {
    icon: 'ingredients',
    title: 'Ingredients',
    text: 'Who orders what and when, with prices that only change from today on.',
  },
];

/** ACC-1: visitors see this page; anyone signed in goes straight to their dashboard. */
export default function Landing() {
  const s = useSession();
  const router = useRouter();
  useEffect(() => {
    if (s.ready && s.me) router.replace(s.membership ? '/app' : '/start');
  }, [s.ready, s.me, s.membership, router]);
  if (!s.ready || s.me) return <Loading />;

  return (
    <main className="landing">
      <header className="row between" style={{ maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div className="row">
          <img
            src="/logo.png"
            alt="Haydar Inc"
            style={{ width: 52, height: 52, objectFit: 'contain' }}
          />
          <b style={{ font: '800 18px var(--heading)', letterSpacing: 2, color: 'var(--primary)' }}>
            HAYDAR
          </b>
        </div>
        <Link className="btn ghost" href="/login">
          Sign in
        </Link>
      </header>
      <section className="hero">
        <h1>Run your bakery’s day in one place</h1>
        <p className="muted">
          Shifts, output, tasks, ingredient ordering, next-day orders and deliveries for your team
          and your contractors.
        </p>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <Link className="btn" href="/register" style={{ minWidth: 200 }}>
            Create account
          </Link>
          <Link className="btn ghost" href="/login" style={{ minWidth: 200 }}>
            Sign in
          </Link>
        </div>
      </section>
      <section className="points">
        {POINTS.map((p) => (
          <div key={p.title} className="card">
            <span style={{ color: 'var(--primary)' }}>
              <Icon name={p.icon} size={28} />
            </span>
            <h2>{p.title}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {p.text}
            </p>
          </div>
        ))}
      </section>
    </main>
  );
}
