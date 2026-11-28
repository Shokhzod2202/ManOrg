import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { activeMembers, orgPeople, PERSON, personOf } from '../common/memberships';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { addDays, localDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { productEconomics } from '../products/product-costs';
import { TimesheetService } from '../shifts/timesheet.service';
import { hourlyRates, rateOn, workedByDay } from '../shifts/worked';
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

  /**
   * The caller's teams: their own private teams (open questions 16 and 17) and the shared teams
   * an admin made that include them. Admins see every shared team.
   */
  listTeams(user: AuthUser, org: OrgContext) {
    const admin = orgCan(org, 'teams.manageShared');
    return this.db.run(dbContext(user, org), async (tx) => ({
      items: await Promise.all(
        (
          await tx.team.findMany({
            where: {
              organizationId: org.organizationId,
              deletedAt: null,
              OR: [
                { shared: false, ownerId: user.userId },
                admin
                  ? { shared: true }
                  : { shared: true, members: { some: { employeeId: user.userId } } },
              ],
            },
            orderBy: [{ shared: 'desc' }, { name: 'asc' }, { id: 'asc' }],
            select: { id: true },
          })
        ).map((t) => this.presentTeam(tx, t.id)),
      ),
      nextCursor: null,
    }));
  }
  /** OUT-4, OUT-5: names of active coworkers, so an employee can build a team. No emails. */
  colleagues(user: AuthUser, org: OrgContext) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.membership.findMany({
        where: { organizationId: org.organizationId, status: 'active', role: 'employee' },
        select: PERSON,
      });
      return {
        // Names only: what employees need to build a team.
        items: rows
          .map(personOf)
          .map((p) => ({ id: p.id, name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        nextCursor: null,
      };
    });
  }

  createTeam(user: AuthUser, org: OrgContext, input: CreateTeamInput) {
    if (input.shared ? !orgCan(org, 'teams.manageShared') : !orgCan(org, 'teams.manage'))
      throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      // An admin's shared team holds the chosen employees; a private team always holds its creator.
      const ids = [...new Set(input.shared ? input.memberIds : [user.userId, ...input.memberIds])];
      if (ids.length === 0) throw Errors.validation({ memberIds: ['Add at least one member.'] });
      await activeMembers(tx, org.organizationId, ids);
      const team = await tx.team.create({
        data: {
          organizationId: org.organizationId,
          ownerId: user.userId,
          shared: input.shared,
          name: input.name,
          members: { create: ids.map((employeeId) => ({ employeeId })) },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'team.create',
        entity: 'team',
        entityId: team.id,
        after: { name: team.name, shared: team.shared, memberIds: ids.sort() },
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
        const ids = [
          ...new Set(team.shared ? input.memberIds : [team.ownerId, ...input.memberIds]),
        ];
        if (ids.length === 0) throw Errors.validation({ memberIds: ['Add at least one member.'] });
        // Decided 2026-11-28: people already on the team may stay even if they were removed from
        // the organization (shown as removed); only people being added must be active members.
        const current = new Set(
          (
            await tx.teamMember.findMany({ where: { teamId: id }, select: { employeeId: true } })
          ).map((m) => m.employeeId),
        );
        await activeMembers(
          tx,
          org.organizationId,
          ids.filter((m) => !current.has(m)),
        );
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
        actor: actorFor(user),
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
        actor: actorFor(user),
        action: 'team.delete',
        entity: 'team',
        entityId: id,
        before,
      });
    });
  }

  /** A private team is changed by its creator; a shared team by an admin. Others get 404. */
  private async ownTeam(tx: Tx, org: OrgContext, user: AuthUser, id: string) {
    const team = await tx.team.findFirst({
      where: { id, organizationId: org.organizationId, deletedAt: null },
    });
    const allowed =
      team && (team.shared ? orgCan(org, 'teams.manageShared') : team.ownerId === user.userId);
    if (!team || !allowed) throw Errors.notFound('Team');
    return team;
  }

  private async presentTeam(tx: Tx, id: string) {
    const team = await tx.team.findUniqueOrThrow({ where: { id }, include: { members: true } });
    const ids = team.members.map((m) => m.employeeId);
    // As the organization names them (decided 2026-11-29).
    const people = [...(await orgPeople(tx, team.organizationId, ids)).values()]
      .map((x) => ({ id: x.id, name: x.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const active = new Set(
      (
        await tx.membership.findMany({
          where: { organizationId: team.organizationId, status: 'active', userId: { in: ids } },
          select: { userId: true },
        })
      ).map((m) => m.userId),
    );
    return {
      id: team.id,
      name: team.name,
      shared: team.shared,
      // Decided 2026-11-28: someone removed from the organization stays listed, marked removed.
      members: people.map((p) => ({ ...p, removed: !active.has(p.id) })),
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

      const active = new Set(
        (
          await tx.membership.findMany({
            where: {
              organizationId: org.organizationId,
              status: 'active',
              userId: { in: teams.flatMap((tm) => tm.members.map((m) => m.employeeId)) },
            },
            select: { userId: true },
          })
        ).map((m) => m.userId),
      );
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
            // Removed people get no share of output logged after their removal (2026-11-28).
            teamMemberIds: team
              ? team.members
                  .map((m) => m.employeeId)
                  .filter((m) => active.has(m))
                  .sort()
              : [],
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
        actor: actorFor(user),
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
      const rows = await tx.membership.findMany({
        where: {
          organizationId: org.organizationId,
          // Decided 2026-11-28: someone removed later still shows for the days they worked.
          OR: [
            { status: 'active' },
            { status: 'removed', removedAt: { gte: dateOf(addDays(date, -1)) } },
          ],
          // Decided 2026-11-25: output management shows employees only, never admins.
          role: 'employee',
          ...(all ? {} : { userId: user.userId }),
        },
        select: { removedAt: true, ...PERSON },
        orderBy: { createdAt: 'asc' },
      });
      const clock = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true, punchToleranceMin: true },
      });
      // Someone removed before this day is left out; removed on or after it, marked removed.
      const members = rows
        .map((r) => ({
          ...personOf(r),
          removedOn: r.removedAt ? localDate(clock.timezone, r.removedAt) : null,
        }))
        .filter((m) => !m.removedOn || m.removedOn >= date);
      const ids = members.map((m) => m.id);
      // The day before too: a night shift that started then and ran into this day is counted
      // there (a shift belongs to the day it started), and is pointed out here (decided 2026-11-26).
      const [timesheets, output] = await Promise.all([
        this.timesheet.days(tx, org.organizationId, clock, ids, addDays(date, -1), date),
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
          employee: { id: m.id, name: m.name, title: m.title },
          removedOn: m.removedOn,
          workedMinutes: timesheets.get(m.id)?.[1]?.workedMinutes ?? 0,
          flags: timesheets.get(m.id)?.[1]?.flags ?? [],
          onShift: (timesheets.get(m.id)?.[1]?.sessions ?? []).some((x) => x.status !== 'ended'),
          carriedOver: carriedOver(timesheets.get(m.id)?.[0], date, clock.timezone),
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

  /**
   * Decided 2026-11-26: Output opens on each employee's latest day with output (within 60 days),
   * with that day's worked hours (finished shifts, as in Work hours).
   */
  latest(user: AuthUser, org: OrgContext) {
    const all = orgCan(org, 'output.readAll');
    return this.db.run(dbContext(user, org), async (tx) => {
      const { timezone } = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true },
      });
      const today = localDate(timezone);
      const from = addDays(today, -59);
      const rows = await tx.membership.findMany({
        where: {
          organizationId: org.organizationId,
          status: 'active',
          role: 'employee',
          ...(all ? {} : { userId: user.userId }),
        },
        select: PERSON,
        orderBy: { createdAt: 'asc' },
      });
      const people = rows.map(personOf);
      const ids = people.map((p) => p.id);
      const [days, worked] = await Promise.all([
        this.days(tx, org, ids, from, today),
        workedByDay(tx, org.organizationId, timezone, ids, from, today),
      ]);
      const employees = people.map((p) => {
        const list = (days.get(p.id) ?? []) as {
          date: string;
          personal: unknown[];
          team: unknown[];
          cleaningHours: number;
        }[];
        const last = [...list]
          .reverse()
          .find((d) => d.personal.length || d.team.length || d.cleaningHours > 0);
        return {
          employee: p,
          date: last?.date ?? null,
          workedMinutes: last ? (worked.get(p.id)?.days.get(last.date)?.minutes ?? 0) : 0,
          output: last ?? null,
        };
      });
      employees.sort(
        (a, b) =>
          (b.date ?? '').localeCompare(a.date ?? '') ||
          a.employee.name.localeCompare(b.employee.name),
      );
      return { today, employees };
    });
  }

  /**
   * Decided 2026-11-26: what one employee's work brought the organization in a month (their
   * "efficiency"). For each product they made (team output credited in equal shares): price
   * minus ingredient cost minus their labor. Labor is their worked hours (punch cards, finished
   * shifts) times their hourly cost, shared over that day's products by expected minutes; hours
   * on days without output stay as unassigned labor. Prices and costs are today's; the hourly cost
   * is the one in force on each day. Hourly cost is for owners only: for other admins every labor
   * figure is null and the result is before labor.
   */
  efficiency(user: AuthUser, org: OrgContext, employeeId: string, month: string | undefined) {
    const owner = org.owner && !user.viaBot;
    return this.db.run(dbContext(user, org), async (tx) => {
      const { timezone } = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true },
      });
      const member = await tx.membership.findFirst({
        where: {
          organizationId: org.organizationId,
          userId: employeeId,
          status: { in: ['active', 'removed'] },
        },
        select: PERSON,
      });
      if (!member) throw Errors.notFound('Employee');
      const today = localDate(timezone);
      const m = month ?? today.slice(0, 7);
      const [y, mo] = m.split('-').map(Number) as [number, number];
      const from = `${m}-01`;
      const to = `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
      const lines = (await this.lines(tx, org, from, to)).filter((l) =>
        l.teamId === null ? l.employeeId === employeeId : l.teamMemberIds.includes(employeeId),
      );
      const [worked, rates, products] = await Promise.all([
        workedByDay(tx, org.organizationId, timezone, [employeeId], from, to),
        owner ? hourlyRates(tx, org.organizationId, [employeeId]) : null,
        productEconomics(tx, org.organizationId, [...new Set(lines.map((l) => l.productId))]),
      ]);
      const workedDays = worked.get(employeeId)!.days;
      const history = rates?.get(employeeId);
      const labor = Boolean(history?.length);

      type Acc = {
        quantity: number;
        expectedMinutes: number;
        revenue: number;
        ingredientCost: number;
        laborCost: number;
      };
      const zero = (): Acc => ({
        quantity: 0,
        expectedMinutes: 0,
        revenue: 0,
        ingredientCost: 0,
        laborCost: 0,
      });
      const byProduct = new Map<string, Acc>();
      const byDay = new Map<string, Acc & { minutes: number; unassignedLabor: number }>();
      // Decided 2026-11-28: each day's products too, not only the month's.
      const dayProducts = new Map<string, Map<string, Acc>>();
      const dates = new Set([...workedDays.keys(), ...lines.map((l) => l.date)]);
      for (const date of [...dates].sort()) {
        const minutes = workedDays.get(date)?.minutes ?? 0;
        const dayLabor = labor ? ((rateOn(history, date, timezone) ?? 0) * minutes) / 60 : 0;
        const mine = lines
          .filter((l) => l.date === date)
          .map((l) => {
            const share = l.teamId === null ? 1 : 1 / Math.max(l.teamMemberIds.length, 1);
            return {
              productId: l.productId,
              quantity: l.quantity * share,
              expected: expectedMinutes(l.quantity, l.minutesPer10) * share,
            };
          });
        const totalExpected = mine.reduce((n, x) => n + x.expected, 0);
        const totalQuantity = mine.reduce((n, x) => n + x.quantity, 0);
        const day = { ...zero(), minutes, unassignedLabor: mine.length ? 0 : dayLabor };
        for (const x of mine) {
          const p = products.get(x.productId);
          const weight =
            totalExpected > 0 ? x.expected / totalExpected : x.quantity / totalQuantity;
          const part = {
            quantity: x.quantity,
            expectedMinutes: x.expected,
            revenue: (p?.unitPrice ?? 0) * x.quantity,
            ingredientCost: (p?.costPerPiece ?? 0) * x.quantity,
            laborCost: dayLabor * weight,
          };
          const acc = byProduct.get(x.productId) ?? zero();
          const perDay = dayProducts.get(date) ?? new Map<string, Acc>();
          const dayAcc = perDay.get(x.productId) ?? zero();
          for (const k of Object.keys(part) as (keyof Acc)[]) {
            acc[k] += part[k];
            day[k] += part[k];
            dayAcc[k] += part[k];
          }
          byProduct.set(x.productId, acc);
          perDay.set(x.productId, dayAcc);
          dayProducts.set(date, perDay);
        }
        byDay.set(date, day);
      }
      const r = (n: number) => Math.round(n);
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const totalMinutes = [...workedDays.values()].reduce((n, d) => n + d.minutes, 0);
      const sum = (k: keyof Acc) => [...byProduct.values()].reduce((n, a) => n + a[k], 0);
      const unassigned = [...byDay.values()].reduce((n, d) => n + d.unassignedLabor, 0);
      const laborTotal = sum('laborCost') + unassigned;
      const contribution = sum('revenue') - sum('ingredientCost') - laborTotal;
      return {
        employee: personOf(member),
        month: m,
        from,
        to,
        // Whether labor is included: an owner, and an hourly cost is set.
        labor,
        hourlyRate: owner ? (history?.at(-1)?.hourlyRate ?? null) : null,
        minutes: totalMinutes,
        products: [...byProduct.entries()]
          .map(([productId, a]) => {
            const p = products.get(productId);
            return {
              productId,
              name: p?.name ?? '',
              quantity: r2(a.quantity),
              unitPrice: p?.unitPrice ?? null,
              costPerPiece: p?.costPerPiece == null ? null : r(p.costPerPiece),
              revenue: r(a.revenue),
              ingredientCost: r(a.ingredientCost),
              expectedMinutes: r(a.expectedMinutes),
              laborCost: labor ? r(a.laborCost) : null,
              contribution: r(a.revenue - a.ingredientCost - (labor ? a.laborCost : 0)),
            };
          })
          .sort((a, b) => b.contribution - a.contribution),
        days: [...byDay.entries()].map(([date, d]) => ({
          date,
          minutes: d.minutes,
          quantity: r2(d.quantity),
          revenue: r(d.revenue),
          ingredientCost: r(d.ingredientCost),
          laborCost: labor ? r(d.laborCost + d.unassignedLabor) : null,
          contribution: r(
            d.revenue - d.ingredientCost - (labor ? d.laborCost + d.unassignedLabor : 0),
          ),
          perHour:
            d.minutes > 0
              ? r(
                  (d.revenue - d.ingredientCost - (labor ? d.laborCost + d.unassignedLabor : 0)) /
                    (d.minutes / 60),
                )
              : null,
          products: [...(dayProducts.get(date)?.entries() ?? [])]
            .map(([productId, a]) => ({
              productId,
              name: products.get(productId)?.name ?? '',
              quantity: r2(a.quantity),
              revenue: r(a.revenue),
              ingredientCost: r(a.ingredientCost),
              laborCost: labor ? r(a.laborCost) : null,
              contribution: r(a.revenue - a.ingredientCost - (labor ? a.laborCost : 0)),
            }))
            .sort((a, b) => b.quantity - a.quantity),
        })),
        totals: {
          quantity: r2(sum('quantity')),
          revenue: r(sum('revenue')),
          ingredientCost: r(sum('ingredientCost')),
          laborCost: labor ? r(laborTotal) : null,
          unassignedLabor: labor ? r(unassigned) : null,
          contribution: r(contribution),
          perHour: totalMinutes > 0 ? r(contribution / (totalMinutes / 60)) : null,
        },
        missing: {
          prices: [...byProduct.keys()].filter((id) => products.get(id)?.unitPrice == null).length,
          costs: [...byProduct.keys()].filter((id) => products.get(id)?.costPerPiece == null)
            .length,
          hourlyRate: owner && !labor,
          // Days with output but no finished shift: no hours, so no labor counted for them.
          daysWithoutHours: [...byDay.values()].filter((d) => d.quantity > 0 && d.minutes === 0)
            .length,
        },
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
    const people = [
      ...(
        await orgPeople(tx, org.organizationId, [...new Set(lines.flatMap((l) => l.teamMemberIds))])
      ).values(),
    ];
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

/**
 * Decided 2026-11-26: a shift from the day before that ran past midnight into `date`. It is
 * counted on the day it started; Output shows it on the next day as a pointer, not as hours.
 */
function carriedOver(
  dayBefore:
    | {
        date: string;
        sessions: {
          startedAt: Date;
          endedAt: Date | null;
          status: string;
          workedMinutes: number;
        }[];
      }
    | undefined,
  date: string,
  timezone: string,
) {
  const now = new Date();
  const into = (dayBefore?.sessions ?? []).filter(
    (s) => localDate(timezone, s.endedAt ?? (s.status === 'ended' ? s.startedAt : now)) >= date,
  );
  if (!dayBefore || !into.length) return null;
  return {
    startedOn: dayBefore.date,
    minutes: into.reduce((n, s) => n + s.workedMinutes, 0),
    ongoing: into.some((s) => s.status !== 'ended'),
  };
}
