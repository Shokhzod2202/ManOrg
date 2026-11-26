'use client';

import Link from 'next/link';
import { formatDate, formatMinutes, type Schemas } from '../../lib/api';
import { t } from '../../lib/i18n';
import { useApi } from '../../lib/use-api';

/**
 * Decided 2026-11-26: on their home page each person sees this month's worked hours (punch
 * cards, finished shifts) and the last few days, with a link to every day and month.
 */
export function MyHours() {
  const { data } = useApi<Schemas['WorkHoursMonth']>('/work-hours', 60_000);
  const me = data?.people[0];
  if (!data || !me) return null;
  const recent = [...me.days].reverse().slice(0, 3);
  return (
    <section className="card">
      <div className="row between">
        <h2>{t('My hours')}</h2>
        <Link href="/app/hours">{t('By day and month')}</Link>
      </div>
      <p style={{ margin: 0 }}>
        {t('This month')}: <b data-testid="my-month-hours">{formatMinutes(me.minutes)}</b>
        <span className="muted small">
          {' '}
          · {me.daysWorked === 1 ? t('1 day') : t('{n} days', { n: me.daysWorked })}
        </span>
      </p>
      {recent.length ? (
        <table className="t">
          <tbody>
            {recent.map((d) => (
              <tr key={d.date}>
                <td>{formatDate(d.date)}</td>
                <td style={{ textAlign: 'right' }}>
                  <b>{formatMinutes(d.minutes)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          {t('No finished shifts this month.')}
        </p>
      )}
      {me.unfinished ? (
        <span className="hint-bad">
          {t('{n} shifts not ended yet: they count once ended.', { n: me.unfinished })}
        </span>
      ) : null}
    </section>
  );
}
