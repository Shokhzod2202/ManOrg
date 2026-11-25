'use client';

import { confirmAction } from '../confirm';
import { useState } from 'react';
import { type ApiError, formatMinutes, formatTime, post, type Schemas } from '../../lib/api';
import { ErrorBox } from '../ui';
import { t } from '../../lib/i18n';
import { useApi } from '../../lib/use-api';

type Card = Schemas['PunchCard'];
const LABEL = { start: 'Start shift', pause: 'Pause', resume: 'Resume', end: 'End shift' } as const;

/** SHF-4: big buttons; the server records the time, never this device. */
export function PunchCard({ card, onChange }: { card: Card; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function punch(action: keyof typeof LABEL) {
    if (
      action === 'end' &&
      !(await confirmAction(t('End your shift now?'), { confirmLabel: t('End shift') }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await post('/punch', { action }, { idempotencyKey: crypto.randomUUID() });
      onChange();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  const status =
    card.status === 'working'
      ? t('Working')
      : card.status === 'paused'
        ? t('Paused')
        : t('Not on shift');
  return (
    <section className="card" aria-label={t('Punch card')}>
      <div className="row between wrap">
        <h2>{t('Punch card')}</h2>
        <span
          className={
            card.status === 'working' ? 'pill ok' : card.status === 'paused' ? 'pill warn' : 'pill'
          }
        >
          {status}
        </span>
      </div>
      <div className="clock">
        {card.current ? formatMinutes(card.current.workedMinutes) : formatTime(card.serverTime)}
      </div>
      <p className="muted center small">
        {card.current
          ? t('Started {time}', { time: formatTime(card.current.startedAt) })
          : t('Server time')}
        {card.todayPlan
          ? ` · ${t('Planned {start}–{end}', { start: card.todayPlan.startTime, end: card.todayPlan.endTime })}${card.todayPlan.endDate !== card.todayPlan.startDate ? ` (${t('ends next day')})` : ''}`
          : ` · ${t('No shift planned today')}`}
      </p>
      <ErrorBox error={error} />
      <div className="punch">
        {card.allowedActions.map((a) => (
          <button
            key={a}
            className={a === 'end' || a === 'pause' ? 'btn big ghost' : 'btn big'}
            disabled={busy}
            onClick={() => punch(a)}
          >
            {t(LABEL[a])}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Decided 2026-11-26: the punch card of an admin who also works shifts, loaded on its own. */
export function MyPunchCard() {
  const { data, error, reload } = useApi<Card>('/punch/card', 30_000);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return <PunchCard card={data} onChange={reload} />;
}
