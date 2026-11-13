import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { activeMembers } from '../common/memberships';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { addDays, localDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { TimesheetService } from '../shifts/timesheet.service';
import { creditFor, expectedMinutes, type LineLike, totalsByProduct } from './calc';
import {
  type CreateTeamInput,
  type OutputRangeInput,
  type PutOutputInput,
  type UpdateTeamInput,
} from './output.schemas';

const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class OutputService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly timesheet: TimesheetService,
  ) {}

  // ------------------------------------------------------------ teams (TEAM-1, OUT-4, OUT-5)

  /** Saved teams are private to their creator (open question 16 / 17). */
  listTeams(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => ({
      items: await Promise.all(
        (
          await tx.team.findMany({
            where: { organizationId: org.organizationId, ownerId: user.userId, deletedAt: null },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: { id: true },
          })
        ).map((t) => this.presentTeam(tx, t.id)),
      ),
      nextCursor: null,
    }));
  }

  createTeam(user: AuthUser, org: OrgContext, input: CreateTeamInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const ids = [...new Set([user.userId, ...input.memberIds])];
      await activeMembers(tx, org.organizationId, ids);
      const team = await tx.team.create({
        data: {
          organizationId: org.organizationId,
          ownerId: user.userId,
          name: input.name,
          members: { create: ids.map((employeeId) => ({ employeeId })) },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'team.create',
        entity: 'team',
        entityId: team.id,
        after: { name: team.name, memberIds: ids.sort() },
      });
      return this.presentTeam(tx, team.id);
    });
  }

  updateTeam(user: AuthUser, org: OrgContext, id: string, input: UpdateTeamInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const team = await this.ownTeam(tx, org, user, id);
      const before = await this.presentTeam(tx, id);
      if (input.name !== undefined) {
        await tx.team.update({
          where: { id },
          data: { name: input.name, version: { increment: 1 } },
        });
      }
      if (input.memberIds !== undefined) {
        const ids = [...new Set([team.ownerId, ...input.memberIds])];
        await activeMembers(tx, org.organizationId, ids);
        await tx.teamMember.deleteMany({ where: { teamId: id } });
        await tx.teamMember.createMany({
          data: ids.map((employeeId) => ({
            organizationId: org.organizationId,
            teamId: id,
            employeeId,
          })),
        });
      }
      const after = await this.presentTeam(tx, id);
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'team.update',
        entity: 'team',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /** Deleting hides the team from its creator; lines already logged keep their member snapshot. */
  deleteTeam(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.ownTeam(tx, org, user, id);
      const before = await this.presentTeam(tx, id);
      await tx.team.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'team.delete',
        entity: 'team',
        entityId: id,
        before,
      });
    });
  }

  private async ownTeam(tx: Tx, org: OrgContext, user: AuthUser, id: string) {
    const team = await tx.team.findFirst({
      where: { id, organizationId: org.organizationId, deletedAt: null },
    });
    // Another person's team is answered as not found: teams are private to their creator.
    if (!team || team.ownerId !== user.userId) throw Errors.notFound('Team');
    return team;
  }

  private async presentTeam(tx: Tx, id: string) {
    const team = await tx.team.findUniqueOrThrow({ where: { id }, include: { members: true } });
    const people = await tx.user.findMany({
      where: { id: { in: team.members.map((m) => m.employeeId) } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      id: team.id,
      name: team.name,
      members: people,
      version: team.version,
      createdAt: team.createdAt,
    };
  }

  // ------------------------------------------------------------ daily output (OUT-1, OUT-6)

  /**
   * Replaces the lines one person logged for a day, and their cleaning hours. Employees log their
   * own output for today or yesterday (a night shift that started yesterday); admins and the bot
   * may log for anyone on any day.
   */
  putOutput(
    user: AuthUser,
    org: OrgContext,
    date: string,
    input: PutOutputInput,
    employeeId?: string,
  ) {
    const target = employeeId ?? user.userId;
    const forOther = target !== user.userId;
    const anyDay = org.actor === 'org_admin' || org.actor === 'bot';
    if (forOther && !anyDay) throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      await activeMembers(tx, org.organizationId, [target]);
      const tz = (
        await tx.organization.findUniqueOrThrow({
          where: { id: org.organizationId },
          select: { timezone: true },
        })
      ).timezone;
      const today = localDate(tz);
      if (!anyDay && date !== today && date !== addDays(today, -1)) {
        throw Errors.unprocessable(
          'OUTPUT_LOCKED',
          'You can enter output for today or yesterday only. Ask an admin to correct older days.',
        );
      }
      if (date > today)
        throw Errors.unprocessable(
          'OUTPUT_IN_FUTURE',
          'Output cannot be entered for a future day.',
        );

      await this.assertProducts(
        tx,
        org,
        target,
        input.lines.map((l) => l.productId),
      );
      const teamIds = [...new Set(input.lines.flatMap((l) => (l.teamId ? [l.teamId] : [])))];
      const teams = await tx.team.findMany({
        where: { id: { in: teamIds }, organizationId: org.organizationId, deletedAt: null },
        include: { members: true },
      });
      for (const teamId of teamIds) {
        const team = teams.find((t) => t.id === teamId);
        if (!team) throw Errors.validation({ lines: [`${teamId} is not a team here.`] });
        if (!team.members.some((m) => m.employeeId === target)) {
          // TEAM-3: "Self should be in Team A".
          throw Errors.validation({
            lines: [`You must be a member of ${team.name} to log its output.`],
          });
        }
      }

      const before = await this.loggedBy(tx, org, target, date);
      await tx.outputEntry.deleteMany({
        where: { organizationId: org.organizationId, employeeId: target, workDate: dateOf(date) },
      });
      for (const l of input.lines) {
        const team = teams.find((t) => t.id === l.teamId);
        const taken =
          team &&
          (await tx.outputEntry.findFirst({
            where: { teamId: team.id, workDate: dateOf(date), productId: l.productId },
            select: { employeeId: true },
          }));
        if (taken) {
          throw Errors.conflict(
            'TEAM_LINE_EXISTS',
            `${team.name} already has this product logged for ${date} by another member.`,
          );
        }
        await tx.outputEntry.create({
          data: {
            organizationId: org.organizationId,
            employeeId: target,
            workDate: dateOf(date),
            productId: l.productId,
            quantity: l.quantity,
            teamId: l.teamId,
            teamMemberIds: team ? team.members.map((m) => m.employeeId).sort() : [],
          },
        });
      }
      await tx.dailyLog.upsert({
        where: {
          organizationId_employeeId_workDate: {
            organizationId: org.organizationId,
            employeeId: target,
            workDate: dateOf(date),
          },
        },
        create: {
          organizationId: org.organizationId,
          employeeId: target,
          workDate: dateOf(date),
          cleaningHours: input.cleaningHours,
        },
        update: { cleaningHours: input.cleaningHours, version: { increment: 1 } },
      });
      const after = await this.loggedBy(tx, org, target, date);
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'output.set',
        entity: 'user',
        entityId: target,
        before: { date, ...before },
        after: { date, ...after },
      });
      return (await this.days(tx, org, [target], date, date)).get(target)![0]!;
    });
  }

  /** OUT-2: per day, personal and team lines, cleaning hours, credited quantity and expected time. */
  getOutput(user: AuthUser, org: OrgContext, input: OutputRangeInput) {
    const target = input.employee_id ?? user.userId;
    if (target !== user.userId && !orgCan(org, 'output.readAll')) throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const [person] = await activeMembers(tx, org.organizationId, [target]);
      return {
        employee: person,
        days: (await this.days(tx, org, [target], input.from, input.to)).get(target) ?? [],
      };
    });
  }

  /**
   * OUT-3: one day, each person's punched hours next to their output and cleaning hours, plus
   * the day's totals per product. Employees see only themselves unless Everyone's output is open.
   */
  shiftOutput(user: AuthUser, org: OrgContext, date: string) {
    const all = orgCan(org, 'output.readAll');
    return this.db.run(dbContext(user, org), async (tx) => {
      const members = (
        await tx.membership.findMany({
          where: {
            organizationId: org.organizationId,
            status: 'active',
            ...(all ? {} : { userId: user.userId }),
          },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        })
      ).map((m) => m.user);
      const ids = members.map((m) => m.id);
      const clock = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true, punchToleranceMin: true },
      });
      const [timesheets, output] = await Promise.all([
        this.timesheet.days(tx, org.organizationId, clock, ids, date, date),
        this.days(tx, org, ids, date, date),
      ]);
      const lines = await this.lines(tx, org, date, date);
      const totals = totalsByProduct(
        all
          ? lines
          : lines.filter(
              (l) => l.employeeId === user.userId || l.teamMemberIds.includes(user.userId),
            ),
      );
      const names = await this.productNames(tx, [...totals.keys()]);
      return {
        date,
        employees: members.map((m) => ({
          employee: m,
          workedMinutes: timesheets.get(m.id)?.[0]?.workedMinutes ?? 0,
          flags: timesheets.get(m.id)?.[0]?.flags ?? [],
          output: output.get(m.id)?.[0],
        })),
        totals: [...totals.entries()].map(([productId, quantity]) => ({
          productId,
          name: names.get(productId) ?? '',
          quantity,
        })),
      };
    });
  }

  private async days(tx: Tx, org: OrgContext, employeeIds: string[], from: string, to: string) {
    const lines = await this.lines(tx, org, from, to);
    const logs = await tx.dailyLog.findMany({
      where: {
        organizationId: org.organizationId,
        employeeId: { in: employeeIds },
        workDate: { gte: dateOf(from), lte: dateOf(to) },
      },
    });
    const names = await this.productNames(tx, [...new Set(lines.map((l) => l.productId))]);
    const teams = await tx.team.findMany({
      where: { id: { in: [...new Set(lines.flatMap((l) => (l.teamId ? [l.teamId] : [])))] } },
      select: { id: true, name: true },
    });
    const people = await tx.user.findMany({
      where: { id: { in: [...new Set(lines.flatMap((l) => l.teamMemberIds))] } },
      select: { id: true, name: true },
    });
    const out = new Map<string, unknown[]>();
    for (const id of employeeIds) {
      const days = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const dayLines = lines.filter((l) => l.date === d);
        const mine = dayLines.filter((l) =>
          l.teamId === null ? l.employeeId === id : l.teamMemberIds.includes(id),
        );
        days.push({
          date: d,
          personal: mine
            .filter((l) => l.teamId === null)
            .map((l) => ({
              productId: l.productId,
              name: names.get(l.productId) ?? '',
              quantity: l.quantity,
              expectedMinutes: expectedMinutes(l.quantity, l.minutesPer10),
            })),
          team: mine
            .filter((l) => l.teamId !== null)
            .map((l) => ({
              team: { id: l.teamId!, name: teams.find((t) => t.id === l.teamId)?.name ?? '' },
              loggedBy: l.employeeId,
              members: l.teamMemberIds.map((m) => ({
                id: m,
                name: people.find((p) => p.id === m)?.name ?? '',
              })),
              productId: l.productId,
              name: names.get(l.productId) ?? '',
              quantity: l.quantity,
              creditedQuantity:
                Math.round((l.quantity / Math.max(l.teamMemberIds.length, 1)) * 100) / 100,
            })),
          cleaningHours: Number(
            logs.find((g) => g.employeeId === id && isoOf(g.workDate) === d)?.cleaningHours ?? 0,
          ),
          ...creditFor(id, dayLines),
        });
      }
      out.set(id, days);
    }
    return out;
  }

  private async lines(
    tx: Tx,
    org: OrgContext,
    from: string,
    to: string,
  ): Promise<(LineLike & { date: string })[]> {
    const rows = await tx.outputEntry.findMany({
      where: {
        organizationId: org.organizationId,
        workDate: { gte: dateOf(from), lte: dateOf(to) },
      },
      include: { product: { select: { minutesPer10: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      date: isoOf(r.workDate),
      productId: r.productId,
      quantity: r.quantity,
      minutesPer10: r.product.minutesPer10,
      teamId: r.teamId,
      teamMemberIds: r.teamMemberIds,
      employeeId: r.employeeId,
    }));
  }

  private async loggedBy(tx: Tx, org: OrgContext, employeeId: string, date: string) {
    const [lines, log] = await Promise.all([
      tx.outputEntry.findMany({
        where: { organizationId: org.organizationId, employeeId, workDate: dateOf(date) },
        select: { productId: true, quantity: true, teamId: true },
        orderBy: [{ teamId: 'asc' }, { productId: 'asc' }],
      }),
      tx.dailyLog.findFirst({
        where: { organizationId: org.organizationId, employeeId, workDate: dateOf(date) },
      }),
    ]);
    return { lines, cleaningHours: log ? Number(log.cleaningHours) : 0 };
  }

  /** PRD-3: an employee logs only products assigned to them. */
  private async assertProducts(tx: Tx, org: OrgContext, employeeId: string, productIds: string[]) {
    const unique = [...new Set(productIds)];
    if (unique.length === 0) return;
    const assigned = await tx.employeeProduct.findMany({
      where: { organizationId: org.organizationId, employeeId, productId: { in: unique } },
      select: { productId: true },
    });
    const ok = new Set(assigned.map((a) => a.productId));
    const missing = unique.filter((p) => !ok.has(p));
    if (missing.length > 0) {
      throw Errors.validation({
        lines: missing.map((p) => `${p} is not one of this employee's products.`),
      });
    }
  }

  private async productNames(tx: Tx, ids: string[]) {
    const rows = await tx.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
