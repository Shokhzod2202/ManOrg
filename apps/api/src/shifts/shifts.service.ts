import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { activeMembers } from '../common/memberships';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { hhmmToTime, localDate, timeToHhmm } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { employeeColorIndex } from './colors';
import {
  type AddPunchInput,
  type ChangeRequestInput,
  type DecisionInput,
  type EditPunchInput,
  type PunchInput,
  type RangeInput,
  type SetShiftsInput,
} from './shifts.schemas';
import { allowedActions, buildSessions, workedMinutes } from './timesheet';
import { type OrgClock, plannedFor, TimesheetService } from './timesheet.service';

@Injectable()
export class ShiftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly timesheet: TimesheetService,
  ) {}

  // ---------------------------------------------------------------- SHF-1 weekly plans

  /** Everyone's plan for readers of all shifts; otherwise only the caller's own. */
  listPlans(user: AuthUser, org: OrgContext, employeeId?: string) {
    const all = orgCan(org, 'shifts.read');
    if (employeeId && employeeId !== user.userId && !all) throw Errors.forbidden();
    const ids = employeeId ? [employeeId] : all ? undefined : [user.userId];
    return this.db.run(dbContext(user, org), async (tx) => {
      const members = await this.members(tx, org, ids);
      const shifts = await tx.shift.findMany({
        where: { organizationId: org.organizationId, employeeId: { in: members.map((m) => m.id) } },
        orderBy: { weekday: 'asc' },
      });
      return {
        items: members.map((m) => ({
          employee: m,
          days: shifts.filter((s) => s.employeeId === m.id).map(presentDay),
        })),
        nextCursor: null,
      };
    });
  }

  setPlan(user: AuthUser, org: OrgContext, input: SetShiftsInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await activeMembers(tx, org.organizationId, [input.employeeId]);
      const before = await tx.shift.findMany({
        where: { organizationId: org.organizationId, employeeId: input.employeeId },
        orderBy: { weekday: 'asc' },
      });
      await tx.shift.deleteMany({
        where: { organizationId: org.organizationId, employeeId: input.employeeId },
      });
      if (input.days.length > 0) {
        await tx.shift.createMany({
          data: input.days.map((d) => ({
            organizationId: org.organizationId,
            employeeId: input.employeeId,
            weekday: d.weekday,
            startTime: hhmmToTime(d.startTime),
            endTime: hhmmToTime(d.endTime),
          })),
        });
      }
      const after = await tx.shift.findMany({
        where: { organizationId: org.organizationId, employeeId: input.employeeId },
        orderBy: { weekday: 'asc' },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'shift.plan_set',
        entity: 'user',
        entityId: input.employeeId,
        before: { days: before.map(presentDay) },
        after: { days: after.map(presentDay) },
      });
      return { employeeId: input.employeeId, days: after.map(presentDay) };
    });
  }

  // ---------------------------------------------------------------- SHF-3 punch card

  card(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), (tx) => this.cardFor(tx, org, user.userId));
  }

  /**
   * Records a punch at the server's time (CLAUDE.md rule 3). A repeated request with the same
   * Idempotency-Key returns the card without recording a second punch.
   */
  punch(user: AuthUser, org: OrgContext, input: PunchInput, idempotencyKey?: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      if (idempotencyKey) {
        const seen = await tx.punchEvent.findFirst({
          where: { organizationId: org.organizationId, employeeId: user.userId, idempotencyKey },
          select: { id: true },
        });
        if (seen) return this.cardFor(tx, org, user.userId);
      }
      const now = new Date();
      const sessions = buildSessions(await this.recentEvents(tx, org, user.userId, now), now);
      if (!allowedActions(sessions).includes(input.action)) {
        throw Errors.conflict('PUNCH_NOT_ALLOWED', punchMessage(input.action));
      }
      await tx.punchEvent.create({
        data: {
          organizationId: org.organizationId,
          employeeId: user.userId,
          eventType: input.action === 'resume' ? 'start' : input.action,
          source: 'self',
          idempotencyKey: idempotencyKey ?? null,
        },
      });
      return this.cardFor(tx, org, user.userId);
    });
  }

  private async cardFor(tx: Tx, org: OrgContext, employeeId: string) {
    const now = new Date();
    const clock = await this.clock(tx, org);
    const sessions = buildSessions(await this.recentEvents(tx, org, employeeId, now), now);
    const open = sessions.at(-1)?.status === 'ended' ? undefined : sessions.at(-1);
    const today = localDate(clock.timezone, now);
    const template = await tx.shift.findFirst({
      where: {
        organizationId: org.organizationId,
        employeeId,
        weekday: new Date(`${today}T00:00:00Z`).getUTCDay(),
      },
    });
    const plan = plannedFor(today, template ?? undefined, clock.timezone);
    return {
      serverTime: now,
      status: open?.status ?? 'off',
      allowedActions: allowedActions(sessions),
      current: open
        ? {
            startedAt: open.startedAt,
            workedMinutes: workedMinutes(open, now),
            events: open.events.map((e) => ({
              id: e.id,
              eventType: e.eventType,
              occurredAt: e.occurredAt,
            })),
          }
        : null,
      todayPlan: plan
        ? {
            startDate: plan.startDate,
            endDate: plan.endDate,
            startTime: plan.startTime,
            endTime: plan.endTime,
          }
        : null,
    };
  }

  private recentEvents(tx: Tx, org: OrgContext, employeeId: string, now: Date) {
    return tx.punchEvent.findMany({
      where: {
        organizationId: org.organizationId,
        employeeId,
        occurredAt: { gte: new Date(now.getTime() - 3 * 86_400_000) },
      },
      orderBy: { occurredAt: 'asc' },
    });
  }

  // ---------------------------------------------------------------- timesheets and dashboards

  /** Punch history with the plan and red flags; an employee may read only their own (403). */
  history(user: AuthUser, org: OrgContext, input: RangeInput) {
    const employeeId = input.employee_id ?? user.userId;
    if (employeeId !== user.userId && !orgCan(org, 'punch.edit')) throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const [member] = await this.members(tx, org, [employeeId]);
      if (!member) throw Errors.notFound('Employee');
      const days = await this.timesheet.days(
        tx,
        org.organizationId,
        await this.clock(tx, org),
        [employeeId],
        input.from,
        input.to,
      );
      return { employee: member, days: days.get(employeeId) ?? [] };
    });
  }

  /** SHF-2, SHF-7, SHF-8: every member's plan, punches and flags for a calendar range. */
  dashboard(user: AuthUser, org: OrgContext, input: RangeInput, onlySelf: boolean) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const members = await this.members(
        tx,
        org,
        onlySelf ? [user.userId] : input.employee_id ? [input.employee_id] : undefined,
      );
      const days = await this.timesheet.days(
        tx,
        org.organizationId,
        await this.clock(tx, org),
        members.map((m) => m.id),
        input.from,
        input.to,
      );
      return {
        from: input.from,
        to: input.to,
        employees: members.map((m) => ({
          employee: m,
          color: employeeColorIndex(m.id),
          days: days.get(m.id) ?? [],
        })),
      };
    });
  }

  // ---------------------------------------------------------------- SHF-4 admin edits

  editPunch(user: AuthUser, org: OrgContext, id: string, version: number, input: EditPunchInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.punchEvent.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!before) throw Errors.notFound('Punch');
      if (before.version !== version) throw Errors.versionConflict();
      const result = await tx.punchEvent.updateMany({
        where: { id, version },
        data: {
          occurredAt: new Date(input.occurredAt),
          source: 'admin',
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      const after = await tx.punchEvent.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'punch.edit',
        entity: 'punch_event',
        entityId: id,
        before,
        after,
      });
      return presentEvent(after);
    });
  }

  addPunch(user: AuthUser, org: OrgContext, input: AddPunchInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await activeMembers(tx, org.organizationId, [input.employeeId]);
      const event = await tx.punchEvent.create({
        data: {
          organizationId: org.organizationId,
          employeeId: input.employeeId,
          eventType: input.eventType,
          occurredAt: new Date(input.occurredAt),
          source: 'admin',
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'punch.add',
        entity: 'punch_event',
        entityId: event.id,
        after: event,
      });
      return presentEvent(event);
    });
  }

  // ---------------------------------------------------------------- SHF-5 change requests

  requestChange(user: AuthUser, org: OrgContext, input: ChangeRequestInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const request = await tx.punchChangeRequest.create({
        data: {
          organizationId: org.organizationId,
          employeeId: user.userId,
          shiftDate: new Date(`${input.shiftDate}T00:00:00Z`),
          requestedStart: new Date(input.requestedStart),
          requestedEnd: new Date(input.requestedEnd),
          reason: input.reason,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'punch_change_request.create',
        entity: 'punch_change_request',
        entityId: request.id,
        after: request,
      });
      return this.presentRequest(tx, org, request.id);
    });
  }

  /** Admins see everyone's requests; an employee sees their own. */
  listRequests(user: AuthUser, org: OrgContext, status: 'pending' | 'approved' | 'rejected') {
    const all = orgCan(org, 'punch.edit');
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.punchChangeRequest.findMany({
        where: {
          organizationId: org.organizationId,
          status,
          ...(all ? {} : { employeeId: user.userId }),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      return {
        items: await Promise.all(rows.map((r) => this.presentRequest(tx, org, r.id))),
        nextCursor: null,
      };
    });
  }

  /**
   * The admin approves or rejects. Approval sets that shift's first start and last end to the
   * requested times (adding them if missing) and audits every changed punch.
   */
  decide(user: AuthUser, org: OrgContext, id: string, input: DecisionInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const request = await tx.punchChangeRequest.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!request) throw Errors.notFound('Change request');
      if (request.status !== 'pending')
        throw Errors.conflict('NOT_PENDING', 'This request has already been decided.');
      const decided = await tx.punchChangeRequest.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          decidedById: user.userId,
          decidedAt: new Date(),
        },
      });
      if (decided.count !== 1)
        throw Errors.conflict('NOT_PENDING', 'This request has already been decided.');
      if (input.decision === 'approve') await this.applyRequest(tx, user, org, request);
      const after = await tx.punchChangeRequest.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: `punch_change_request.${input.decision}`,
        entity: 'punch_change_request',
        entityId: id,
        before: request,
        after,
      });
      return this.presentRequest(tx, org, id);
    });
  }

  private async applyRequest(
    tx: Tx,
    user: AuthUser,
    org: OrgContext,
    request: {
      employeeId: string;
      shiftDate: Date;
      requestedStart: Date | null;
      requestedEnd: Date | null;
    },
  ) {
    const clock = await this.clock(tx, org);
    const date = request.shiftDate.toISOString().slice(0, 10);
    const days = await this.timesheet.days(
      tx,
      org.organizationId,
      clock,
      [request.employeeId],
      date,
      date,
    );
    const sessions = days.get(request.employeeId)?.[0]?.sessions ?? [];
    const events = sessions.flatMap((s) => s.events);
    const firstStart = events.find((e) => e.eventType === 'start');
    const lastEnd = [...events].reverse().find((e) => e.eventType === 'end');
    const set = async (
      event: { id: string } | undefined,
      type: 'start' | 'end',
      at: Date | null,
    ) => {
      if (!at) return;
      if (event) {
        const before = await tx.punchEvent.findUniqueOrThrow({ where: { id: event.id } });
        const after = await tx.punchEvent.update({
          where: { id: event.id },
          data: { occurredAt: at, source: 'admin', version: { increment: 1 } },
        });
        await this.audit.record(tx, {
          organizationId: org.organizationId,
          actor: userActor(user.userId),
          action: 'punch.edit',
          entity: 'punch_event',
          entityId: event.id,
          before,
          after,
        });
      } else {
        const created = await tx.punchEvent.create({
          data: {
            organizationId: org.organizationId,
            employeeId: request.employeeId,
            eventType: type,
            occurredAt: at,
            source: 'admin',
          },
        });
        await this.audit.record(tx, {
          organizationId: org.organizationId,
          actor: userActor(user.userId),
          action: 'punch.add',
          entity: 'punch_event',
          entityId: created.id,
          after: created,
        });
      }
    };
    await set(firstStart, 'start', request.requestedStart);
    await set(lastEnd, 'end', request.requestedEnd);
  }

  private async presentRequest(tx: Tx, org: OrgContext, id: string) {
    const r = await tx.punchChangeRequest.findUniqueOrThrow({ where: { id } });
    const clock = await this.clock(tx, org);
    const date = r.shiftDate.toISOString().slice(0, 10);
    const original = (
      await this.timesheet.days(tx, org.organizationId, clock, [r.employeeId], date, date)
    ).get(r.employeeId)?.[0];
    const employee = await tx.user.findUnique({
      where: { id: r.employeeId },
      select: { id: true, name: true },
    });
    const first = original?.sessions[0];
    const last = original?.sessions.at(-1);
    return {
      id: r.id,
      employee,
      shiftDate: date,
      original: { start: first?.startedAt ?? null, end: last?.endedAt ?? null },
      requested: { start: r.requestedStart, end: r.requestedEnd },
      reason: r.reason,
      status: r.status,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async clock(tx: Tx, org: OrgContext): Promise<OrgClock> {
    return tx.organization.findUniqueOrThrow({
      where: { id: org.organizationId },
      select: { timezone: true, punchToleranceMin: true },
    });
  }

  /** Active members (all, or the given ids), by name. Unknown ids answer 404. */
  private async members(tx: Tx, org: OrgContext, ids?: string[]) {
    const rows = await tx.membership.findMany({
      where: {
        organizationId: org.organizationId,
        status: 'active',
        ...(ids ? { userId: { in: ids } } : {}),
      },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (ids && rows.length !== new Set(ids).size) throw Errors.notFound('Employee');
    return rows.map((r) => r.user);
  }
}

function presentDay(s: { weekday: number; startTime: Date; endTime: Date }) {
  const startTime = timeToHhmm(s.startTime);
  const endTime = timeToHhmm(s.endTime);
  return { weekday: s.weekday, startTime, endTime, endsNextDay: endTime <= startTime };
}

function presentEvent(e: {
  id: string;
  employeeId: string;
  eventType: string;
  occurredAt: Date;
  source: string;
  version: number;
}) {
  return {
    id: e.id,
    employeeId: e.employeeId,
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    source: e.source,
    version: e.version,
  };
}

function punchMessage(action: string): string {
  return (
    {
      start: 'A shift is already running; pause or end it first.',
      pause: 'Start your shift before pausing.',
      resume: 'There is no paused shift to resume.',
      end: 'There is no running shift to end.',
    }[action] ?? 'Not allowed now.'
  );
}
