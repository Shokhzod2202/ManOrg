import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { PERSON, personOf, WORKS_SHIFTS } from '../common/memberships';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { addDays, localDate, zonedToUtc } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { type CancelAdvanceInput, type CreateAdvanceInput, type HoursQuery } from './hours.schemas';
import { buildSessions, type PunchEventLike, workedMinutes } from './timesheet';

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The first and last date of a YYYY-MM month. */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * Decided 2026-11-30: worked hours come from punch cards only, never from the shift plan. A shift
 * counts once it has ended, on the local date it started (a night shift is one shift), with
 * paused time left out (open question 7). Advances ("avans") are logged by admins when they
 * transfer the money and shown in the month they were paid.
 */
@Injectable()
export class HoursService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  month(user: AuthUser, org: OrgContext, input: HoursQuery) {
    const everyone = orgCan(org, 'advances.manage');
    // Without admin rights a person sees only their own hours and advances.
    if (!everyone && input.employee_id && input.employee_id !== user.userId) {
      throw Errors.forbidden();
    }
    const only = everyone ? input.employee_id : user.userId;
    return this.db.run(dbContext(user, org), async (tx) => {
      const { timezone } = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true },
      });
      const today = localDate(timezone);
      const month = input.month ?? today.slice(0, 7);
      const { from, to } = monthRange(month);
      const members = await tx.membership.findMany({
        where: {
          organizationId: org.organizationId,
          AND: [
            WORKS_SHIFTS,
            {
              OR: [
                { status: 'active' as const },
                // Removed people show for the months up to their removal (if they worked).
                { status: 'removed' as const, removedAt: { gte: day(addDays(from, -1)) } },
              ],
            },
          ],
          ...(only ? { userId: only } : {}),
        },
        select: { ...PERSON, status: true, removedAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const ids = members.map((m) => m.user.id);
      const [events, advances] = await Promise.all([
        tx.punchEvent.findMany({
          where: {
            organizationId: org.organizationId,
            employeeId: { in: ids },
            occurredAt: {
              gte: zonedToUtc(addDays(from, -1), '00:00', timezone),
              lt: zonedToUtc(addDays(to, 2), '00:00', timezone),
            },
          },
          orderBy: { occurredAt: 'asc' },
        }),
        tx.salaryAdvance.findMany({
          where: {
            organizationId: org.organizationId,
            employeeId: { in: ids },
            paidOn: { gte: day(from), lte: day(to) },
          },
          orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);
      const now = new Date();
      const people = members.map((m) => {
        const id = m.user.id;
        const sessions = buildSessions(
          events.filter((e) => e.employeeId === id) as PunchEventLike[],
          now,
        );
        const byDate = new Map<string, { minutes: number; shifts: number }>();
        const open: Date[] = [];
        for (const s of sessions) {
          const date = localDate(timezone, s.startedAt);
          if (date < from || date > to) continue;
          // Still working, paused, or End Shift forgotten: not counted until it is ended.
          if (s.status !== 'ended' || !s.endedAt) {
            open.push(s.startedAt);
            continue;
          }
          const d = byDate.get(date) ?? { minutes: 0, shifts: 0 };
          d.minutes += workedMinutes(s, now);
          d.shifts += 1;
          byDate.set(date, d);
        }
        const days = [...byDate.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, d]) => ({ date, minutes: d.minutes, shifts: d.shifts }));
        const own = advances.filter((a) => a.employeeId === id).map(presentAdvance);
        return {
          employee: personOf(m),
          removedOn:
            m.status === 'removed' && m.removedAt ? localDate(timezone, m.removedAt) : null,
          minutes: days.reduce((n, d) => n + d.minutes, 0),
          daysWorked: days.length,
          unfinished: open.length,
          // Decided 2026-11-26: when each of those started, so a forgotten End Shift is found.
          openSince: open,
          days,
          advances: {
            total: own.filter((a) => !a.cancelledAt).reduce((n, a) => n + a.amount, 0),
            items: own,
          },
        };
      });
      // A removed person is listed only for a month they worked or were paid in.
      const shown = people.filter(
        (p) => !p.removedOn || p.minutes > 0 || p.unfinished > 0 || p.advances.items.length > 0,
      );
      return {
        month,
        from,
        to,
        today,
        timezone,
        people: shown,
        totals: {
          minutes: shown.reduce((n, p) => n + p.minutes, 0),
          advances: shown.reduce((n, p) => n + p.advances.total, 0),
        },
      };
    });
  }

  /** An admin logs an advance when they transfer the money. Audited. */
  createAdvance(user: AuthUser, org: OrgContext, input: CreateAdvanceInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const { timezone } = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true },
      });
      const today = localDate(timezone);
      const paidOn = input.paidOn ?? today;
      if (paidOn > today) {
        throw Errors.validation({ paidOn: ['Log an advance once the money is sent, not before.'] });
      }
      const member = await tx.membership.findFirst({
        where: {
          organizationId: org.organizationId,
          userId: input.employeeId,
          status: { in: ['active', 'removed'] },
        },
        select: { id: true },
      });
      if (!member) throw Errors.notFound('Employee');
      const row = await tx.salaryAdvance.create({
        data: {
          organizationId: org.organizationId,
          employeeId: input.employeeId,
          amount: input.amount,
          paidOn: day(paidOn),
          note: input.note || null,
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'salary_advance.create',
        entity: 'salary_advance',
        entityId: row.id,
        after: row,
      });
      return presentAdvance(row);
    });
  }

  /** A mistaken advance is cancelled, never edited or deleted. Audited. */
  cancelAdvance(user: AuthUser, org: OrgContext, id: string, input: CancelAdvanceInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.find(tx, org, id);
      if (before.cancelledAt) {
        throw Errors.conflict('ALREADY_CANCELLED', 'This advance is already cancelled.');
      }
      const result = await tx.salaryAdvance.updateMany({
        where: { id, version: before.version },
        data: {
          cancelledAt: new Date(),
          cancelledById: user.userId,
          cancelReason: input.reason || null,
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      const after = await tx.salaryAdvance.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'salary_advance.cancel',
        entity: 'salary_advance',
        entityId: id,
        before,
        after,
      });
      return presentAdvance(after);
    });
  }

  private async find(tx: Tx, org: OrgContext, id: string) {
    const row = await tx.salaryAdvance.findFirst({
      where: { id, organizationId: org.organizationId },
    });
    if (!row) throw Errors.notFound('Advance');
    return row;
  }
}

function presentAdvance(a: {
  id: string;
  employeeId: string;
  amount: number;
  paidOn: Date;
  note: string | null;
  createdById: string;
  createdAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
}) {
  return {
    id: a.id,
    employeeId: a.employeeId,
    amount: a.amount,
    paidOn: iso(a.paidOn),
    note: a.note,
    createdById: a.createdById,
    createdAt: a.createdAt,
    cancelledAt: a.cancelledAt,
    cancelReason: a.cancelReason,
  };
}
