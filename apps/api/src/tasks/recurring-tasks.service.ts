import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { activeMembers, orgPeople } from '../common/memberships';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { isoDate, localDate, weekdayOfDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { NotificationsService } from '../notifications/notifications.service';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const SYSTEM_USER = '00000000-0000-4000-8000-000000000000';

const fields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  assigneeId: z.uuid(),
  assigneeIds: z.array(z.uuid()).min(1).max(200),
  forAll: z.boolean(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
};

const rules = <
  T extends {
    assigneeId?: string;
    assigneeIds?: string[];
    forAll?: boolean;
    frequency?: string;
    weekdays?: number[];
    dayOfMonth?: number | null;
    startDate?: string;
    endDate?: string | null;
  },
>(
  v: T,
  ctx: z.RefinementCtx,
) => {
  const who = [v.assigneeId !== undefined, v.assigneeIds !== undefined, v.forAll === true];
  if (who.filter(Boolean).length > 1)
    ctx.addIssue({
      code: 'custom',
      path: ['assigneeIds'],
      message: 'Choose people or "For all", not both.',
    });
  if (v.frequency === 'weekly' && !v.weekdays?.length) {
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose at least one weekday.' });
  }
  if (v.frequency === 'monthly' && !v.dayOfMonth) {
    ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Choose the day of the month.' });
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The end is before the start.' });
  }
};

const optionalWho = {
  assigneeId: fields.assigneeId.optional(),
  assigneeIds: fields.assigneeIds.optional(),
  forAll: fields.forAll.optional(),
};
export const createRecurringSchema = z
  .strictObject({ ...fields, ...optionalWho })
  .superRefine(rules)
  .superRefine((v, ctx) => {
    if (!v.assigneeId && !v.assigneeIds && !v.forAll)
      ctx.addIssue({ code: 'custom', path: ['assigneeIds'], message: 'Choose who it is for.' });
  });
export const updateRecurringSchema = z
  .strictObject(fields)
  .partial()
  .extend({ active: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.')
  .superRefine(rules);
export type CreateRecurringInput = z.infer<typeof createRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;

type Rule = {
  frequency: 'daily' | 'weekly' | 'monthly';
  weekdays: number[];
  dayOfMonth: number | null;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
};

/** Whether a rule makes a task on a day (organization calendar date). */
export function dueOn(rule: Rule, date: string): boolean {
  if (!rule.active || date < iso(rule.startDate) || (rule.endDate && date > iso(rule.endDate)))
    return false;
  if (rule.frequency === 'daily') return true;
  if (rule.frequency === 'weekly') return rule.weekdays.includes(weekdayOfDate(date));
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d === Math.min(rule.dayOfMonth ?? 1, last);
}

/**
 * Phase 3: repeating tasks. A rule makes one ordinary task (with its camera-photo completion) on
 * each due day; the database refuses a second task for the same rule and day, so several servers
 * running the job cannot double it.
 */
@Injectable()
export class RecurringTasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.recurringTask.findMany({
        where: { organizationId: org.organizationId },
        orderBy: [{ active: 'desc' }, { title: 'asc' }],
      });
      return { items: await Promise.all(rows.map((r) => this.present(tx, r))), nextCursor: null };
    });
  }

  create(user: AuthUser, org: OrgContext, input: CreateRecurringInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const who = await this.who(tx, org, input);
      const rule = await tx.recurringTask.create({
        data: {
          organizationId: org.organizationId,
          ...who,
          title: input.title,
          description: input.description ?? null,
          frequency: input.frequency,
          weekdays: input.frequency === 'weekly' ? [...new Set(input.weekdays)].sort() : [],
          dayOfMonth: input.frequency === 'monthly' ? (input.dayOfMonth ?? null) : null,
          startDate: day(input.startDate),
          endDate: input.endDate ? day(input.endDate) : null,
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'recurring_task.create',
        entity: 'recurring_task',
        entityId: rule.id,
        after: rule,
      });
      // A rule due today makes today's task right away.
      await this.makeDue(tx, org.organizationId, await this.today(tx, org.organizationId), [
        rule.id,
      ]);
      return this.present(tx, rule);
    });
  }

  update(
    user: AuthUser,
    org: OrgContext,
    id: string,
    version: number,
    input: UpdateRecurringInput,
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.recurringTask.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!before) throw Errors.notFound('Repeating task');
      if (before.version !== version) throw Errors.versionConflict();
      const changesWho =
        input.assigneeId !== undefined ||
        input.assigneeIds !== undefined ||
        input.forAll !== undefined;
      const who = changesWho ? await this.who(tx, org, input) : null;
      const frequency = input.frequency ?? before.frequency;
      const weekdays = input.weekdays ?? before.weekdays;
      const dayOfMonth = input.dayOfMonth !== undefined ? input.dayOfMonth : before.dayOfMonth;
      if (frequency === 'weekly' && !weekdays.length)
        throw Errors.validation({ weekdays: ['Choose at least one weekday.'] });
      if (frequency === 'monthly' && !dayOfMonth)
        throw Errors.validation({ dayOfMonth: ['Choose the day of the month.'] });
      const after = await tx.recurringTask.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(who ?? {}),
          frequency,
          weekdays: frequency === 'weekly' ? [...new Set(weekdays)].sort() : [],
          dayOfMonth: frequency === 'monthly' ? dayOfMonth : null,
          ...(input.startDate !== undefined ? { startDate: day(input.startDate) } : {}),
          ...(input.endDate !== undefined
            ? { endDate: input.endDate ? day(input.endDate) : null }
            : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'recurring_task.update',
        entity: 'recurring_task',
        entityId: id,
        before,
        after,
      });
      return this.present(tx, after);
    });
  }

  /** One person, several people (kept in assigneeIds) or everyone; people must be active members. */
  private async who(
    tx: Tx,
    org: OrgContext,
    input: { assigneeId?: string; assigneeIds?: string[]; forAll?: boolean },
  ): Promise<{ assigneeId: string | null; assigneeIds: string[]; forAll: boolean }> {
    if (input.forAll) return { assigneeId: null, assigneeIds: [], forAll: true };
    const ids = [...new Set(input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : []))];
    await activeMembers(tx, org.organizationId, ids);
    return ids.length === 1
      ? { assigneeId: ids[0]!, assigneeIds: [], forAll: false }
      : { assigneeId: null, assigneeIds: ids, forAll: false };
  }

  /** The job: today's tasks for every organization, in its own time zone. */
  async generate(now = new Date()): Promise<number> {
    const orgs = await this.db.run({ organizationId: null, userId: SYSTEM_USER }, (tx) =>
      tx.organization.findMany({
        select: { id: true, timezone: true },
      }),
    );
    let made = 0;
    for (const o of orgs) {
      made += await this.db.run({ organizationId: o.id, userId: null }, (tx) =>
        this.makeDue(tx, o.id, localDate(o.timezone, now)),
      );
    }
    return made;
  }

  private async makeDue(
    tx: Tx,
    organizationId: string,
    date: string,
    only?: string[],
  ): Promise<number> {
    const rules = await tx.recurringTask.findMany({
      where: { organizationId, active: true, ...(only ? { id: { in: only } } : {}) },
    });
    let made = 0;
    for (const r of rules) {
      if (!dueOn(r, date)) continue;
      const exists = await tx.task.findFirst({
        where: { recurringTaskId: r.id, occurrenceDate: day(date) },
        select: { id: true },
      });
      if (exists) continue;
      // People who have left get no new tasks; with nobody left the rule waits for the admin.
      const named = r.assigneeId ? [r.assigneeId] : r.assigneeIds;
      const people = r.forAll
        ? []
        : (
            await tx.membership.findMany({
              where: { organizationId, userId: { in: named }, status: 'active' },
              select: { userId: true },
            })
          ).map((m) => m.userId);
      if (!r.forAll && !people.length) continue;
      const task = await tx.task.create({
        data: {
          organizationId,
          assigneeId: !r.forAll && people.length === 1 ? people[0]! : null,
          forAll: r.forAll,
          createdById: r.createdById,
          title: r.title,
          description: r.description,
          dueDate: day(date),
          recurringTaskId: r.id,
          occurrenceDate: day(date),
          ...(people.length > 1
            ? { assignees: { create: people.map((employeeId) => ({ employeeId })) } }
            : {}),
        },
      });
      const told = r.forAll
        ? (
            await tx.membership.findMany({
              where: { organizationId, status: 'active', role: 'employee' },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : people;
      await this.notifications.notify(tx, {
        organizationId,
        userIds: told,
        type: 'task.assigned',
        payload: { taskId: task.id, title: task.title, dueDate: date, repeating: true },
      });
      made += 1;
    }
    return made;
  }

  private async today(tx: Tx, organizationId: string): Promise<string> {
    const o = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    return localDate(o?.timezone ?? 'Asia/Seoul');
  }

  private async present(tx: Tx, r: Awaited<ReturnType<Tx['recurringTask']['findFirstOrThrow']>>) {
    const ids = r.assigneeId ? [r.assigneeId] : r.assigneeIds;
    // Decided 2026-11-29: as the organization names them.
    const people = [...(await orgPeople(tx, r.organizationId, ids)).values()].map((x) => ({
      id: x.id,
      name: x.name,
    }));
    const assignees = ids
      .map((id) => people.find((p) => p.id === id))
      .filter((p): p is { id: string; name: string } => !!p);
    const last = await tx.task.findFirst({
      where: { recurringTaskId: r.id },
      orderBy: { occurrenceDate: 'desc' },
      select: { occurrenceDate: true, status: true },
    });
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      assignee: r.assigneeId ? (assignees[0] ?? null) : null,
      assignees,
      forAll: r.forAll,
      frequency: r.frequency,
      weekdays: r.weekdays,
      dayOfMonth: r.dayOfMonth,
      startDate: iso(r.startDate),
      endDate: r.endDate ? iso(r.endDate) : null,
      active: r.active,
      lastMade: last?.occurrenceDate
        ? { date: iso(last.occurrenceDate), status: last.status }
        : null,
      version: r.version,
      createdAt: r.createdAt,
    };
  }
}
