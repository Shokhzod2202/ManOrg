import { Injectable } from '@nestjs/common';
import { type Tx } from '../database/prisma-client';
import {
  addDays,
  dateRange,
  localDate,
  timeToHhmm,
  weekdayOfDate,
  zonedToUtc,
} from '../common/time';
import {
  buildSessions,
  flagsFor,
  type PlannedShift,
  type PunchEventLike,
  type Session,
  workedMinutes,
} from './timesheet';

export interface OrgClock {
  timezone: string;
  punchToleranceMin: number;
}

type Template = { employeeId: string; weekday: number; startTime: Date; endTime: Date };

export function plannedFor(
  date: string,
  template: Template | undefined,
  tz: string,
): PlannedShift | null {
  if (!template) return null;
  const startTime = timeToHhmm(template.startTime);
  const endTime = timeToHhmm(template.endTime);
  const endDate = endTime > startTime ? date : addDays(date, 1);
  return {
    startDate: date,
    endDate,
    startTime,
    endTime,
    plannedStart: zonedToUtc(date, startTime, tz),
    plannedEnd: zonedToUtc(endDate, endTime, tz),
  };
}

function presentSession(s: Session, now: Date) {
  return {
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    status: s.status,
    workedMinutes: workedMinutes(s, now),
    events: s.events.map((e) => ({ id: e.id, eventType: e.eventType, occurredAt: e.occurredAt })),
  };
}

/** Plans, punches and red flags per employee per day (SHF-2, SHF-6, SHF-7). */
@Injectable()
export class TimesheetService {
  async days(
    tx: Tx,
    organizationId: string,
    clock: OrgClock,
    employeeIds: string[],
    from: string,
    to: string,
    now = new Date(),
  ) {
    const tz = clock.timezone;
    const [templates, events] = await Promise.all([
      tx.shift.findMany({ where: { organizationId, employeeId: { in: employeeIds } } }),
      tx.punchEvent.findMany({
        where: {
          organizationId,
          employeeId: { in: employeeIds },
          occurredAt: {
            gte: zonedToUtc(addDays(from, -1), '00:00', tz),
            lt: zonedToUtc(addDays(to, 2), '00:00', tz),
          },
        },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);
    const result = new Map<string, ReturnType<typeof this.day>[]>();
    for (const employeeId of employeeIds) {
      const own = events.filter((e) => e.employeeId === employeeId) as (PunchEventLike & {
        employeeId: string;
      })[];
      const sessions = buildSessions(own, now);
      const byDate = new Map<string, Session[]>();
      for (const s of sessions) {
        const d = localDate(tz, s.startedAt);
        byDate.set(d, [...(byDate.get(d) ?? []), s]);
      }
      const plan = templates.filter((t) => t.employeeId === employeeId);
      result.set(
        employeeId,
        dateRange(from, to).map((date) =>
          this.day(
            date,
            plannedFor(
              date,
              plan.find((t) => t.weekday === weekdayOfDate(date)),
              tz,
            ),
            byDate.get(date) ?? [],
            clock,
            now,
          ),
        ),
      );
    }
    return result;
  }

  private day(
    date: string,
    plan: PlannedShift | null,
    sessions: Session[],
    clock: OrgClock,
    now: Date,
  ) {
    // Several shifts on one day are compared with the plan as one: first start to last end.
    const first = sessions[0];
    const last = sessions.at(-1);
    const merged: Session | null =
      first && last
        ? {
            ...last,
            startedAt: first.startedAt,
            intervals: sessions.flatMap((s) => s.intervals),
            events: sessions.flatMap((s) => s.events),
          }
        : null;
    return {
      date,
      planned: plan
        ? {
            startDate: plan.startDate,
            endDate: plan.endDate,
            startTime: plan.startTime,
            endTime: plan.endTime,
            start: plan.plannedStart,
            end: plan.plannedEnd,
          }
        : null,
      sessions: sessions.map((s) => presentSession(s, now)),
      workedMinutes: sessions.reduce((sum, s) => sum + workedMinutes(s, now), 0),
      flags: flagsFor(plan, merged, clock.punchToleranceMin, now),
    };
  }
}
