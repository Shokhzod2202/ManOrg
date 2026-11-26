import { addDays, localDate, zonedToUtc } from '../common/time';
import { type Tx } from '../database/prisma-client';
import { buildSessions, type PunchEventLike, workedMinutes } from './timesheet';

export type WorkedDay = { minutes: number; shifts: number };

/**
 * Decided 2026-11-30: worked time from punch cards only, never the shift plan. A shift counts
 * once it has ended, on the local date it started, with paused time left out. Shifts still open
 * (or never ended) are returned separately, by when they started.
 */
export async function workedByDay(
  tx: Tx,
  organizationId: string,
  timezone: string,
  employeeIds: string[],
  from: string,
  to: string,
  now = new Date(),
): Promise<Map<string, { days: Map<string, WorkedDay>; open: Date[] }>> {
  const events = await tx.punchEvent.findMany({
    where: {
      organizationId,
      employeeId: { in: employeeIds },
      occurredAt: {
        gte: zonedToUtc(addDays(from, -1), '00:00', timezone),
        lt: zonedToUtc(addDays(to, 2), '00:00', timezone),
      },
    },
    orderBy: { occurredAt: 'asc' },
  });
  const out = new Map<string, { days: Map<string, WorkedDay>; open: Date[] }>();
  for (const id of employeeIds) {
    const sessions = buildSessions(
      events.filter((e) => e.employeeId === id) as PunchEventLike[],
      now,
    );
    const days = new Map<string, WorkedDay>();
    const open: Date[] = [];
    for (const s of sessions) {
      const date = localDate(timezone, s.startedAt);
      if (date < from || date > to) continue;
      if (s.status !== 'ended' || !s.endedAt) {
        open.push(s.startedAt);
        continue;
      }
      const d = days.get(date) ?? { minutes: 0, shifts: 0 };
      d.minutes += workedMinutes(s, now);
      d.shifts += 1;
      days.set(date, d);
    }
    out.set(id, { days, open });
  }
  return out;
}

/**
 * Decided 2026-11-26: each person's hourly cost history (owners only), oldest first, so a day is
 * costed at the rate in force on it.
 */
export async function hourlyRates(tx: Tx, organizationId: string, employeeIds: string[]) {
  const rows = await tx.hourlyRate.findMany({
    where: { organizationId, employeeId: { in: employeeIds } },
    orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    select: { employeeId: true, hourlyRate: true, effectiveFrom: true },
  });
  const out = new Map<string, { hourlyRate: number; effectiveFrom: Date }[]>();
  for (const r of rows) out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), r]);
  return out;
}

/** The rate in force at the end of a local day; before any rate was set, the first one. */
export function rateOn(
  history: { hourlyRate: number; effectiveFrom: Date }[] | undefined,
  date: string,
  timezone: string,
): number | null {
  if (!history?.length) return null;
  const end = zonedToUtc(addDays(date, 1), '00:00', timezone);
  let rate = history[0]!.hourlyRate;
  for (const h of history) if (h.effectiveFrom < end) rate = h.hourlyRate;
  return rate;
}
