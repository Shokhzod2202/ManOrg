import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { addDays, localDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { DueNextService } from '../deliveries/due-next.service';
import { OutputService } from '../output/output.service';
import { ShiftsService } from '../shifts/shifts.service';
import { TimesheetService } from '../shifts/timesheet.service';

const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);

@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly timesheet: TimesheetService,
    private readonly dueNext: DueNextService,
    private readonly shifts: ShiftsService,
    private readonly output: OutputService,
  ) {}

  /**
   * DSH-1, Today's Dashboard: who is on shift now, red flags, today's output, today's tasks and
   * deliveries, and what is waiting for a decision.
   */
  async today(user: AuthUser, org: OrgContext) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    const base = await this.db.run(dbContext(user, org), async (tx) => {
      const clock = await tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true, punchToleranceMin: true },
      });
      const today = localDate(clock.timezone);
      const members = (
        await tx.membership.findMany({
          where: { organizationId: org.organizationId, status: 'active' },
          select: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        })
      ).map((m) => m.user);
      // Yesterday too, so a night shift that started before midnight still shows as on shift.
      const days = await this.timesheet.days(
        tx,
        org.organizationId,
        clock,
        members.map((m) => m.id),
        addDays(today, -1),
        today,
      );
      const onShift = members.flatMap((m) => {
        const open = (days.get(m.id) ?? [])
          .flatMap((d) => d.sessions)
          .find((s) => s.status !== 'ended');
        return open
          ? [
              {
                employee: m,
                status: open.status,
                startedAt: open.startedAt,
                workedMinutes: open.workedMinutes,
              },
            ]
          : [];
      });
      const flags = members.flatMap((m) => {
        const day = (days.get(m.id) ?? []).find((d) => d.date === today);
        return day && day.flags.length > 0 ? [{ employee: m, flags: day.flags }] : [];
      });
      const [
        tasksDue,
        tasksDone,
        applications,
        punchRequests,
        orderChanges,
        deliveryChanges,
        ingredientOrders,
        deliveries,
      ] = await Promise.all([
        tx.task.findMany({
          where: {
            organizationId: org.organizationId,
            status: 'open',
            OR: [{ dueDate: { lte: dateOf(today) } }, { dueDate: null }],
          },
          select: { id: true, title: true, dueDate: true, assigneeId: true, taskType: true },
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
          take: 50,
        }),
        tx.task.count({
          where: {
            organizationId: org.organizationId,
            status: 'done',
            completedAt: { gte: new Date(Date.now() - 86_400_000) },
          },
        }),
        tx.membership.count({ where: { organizationId: org.organizationId, status: 'pending' } }),
        tx.punchChangeRequest.count({
          where: { organizationId: org.organizationId, status: 'pending' },
        }),
        tx.orderChangeRequest.count({
          where: { organizationId: org.organizationId, status: 'open' },
        }),
        tx.deliveryChangeRequest.count({
          where: { organizationId: org.organizationId, status: 'pending' },
        }),
        tx.ingredientOrder.count({
          where: { organizationId: org.organizationId, status: { in: ['requested', 'fulfilled'] } },
        }),
        tx.delivery.findMany({
          where: { organizationId: org.organizationId, deliveryDate: dateOf(today) },
          include: { contractor: { select: { id: true, name: true } } },
          orderBy: { windowStart: 'asc' },
        }),
      ]);
      const contractorApplications = await tx.contractorLink.count({
        where: { organizationId: org.organizationId, status: 'pending' },
      });
      return {
        today,
        onShift,
        flags,
        tasks: {
          due: tasksDue.map((t) => ({
            id: t.id,
            title: t.title,
            type: t.taskType,
            dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
            assigneeId: t.assigneeId,
          })),
          doneLast24h: tasksDone,
        },
        deliveriesToday: deliveries.map((d) => ({
          id: d.id,
          contractor: d.contractor,
          status: d.status,
          windowStart: d.windowStart,
          windowEnd: d.windowEnd,
        })),
        waiting: {
          applications: applications + contractorApplications,
          punchChangeRequests: punchRequests,
          orderChangeRequests: orderChanges,
          deliveryChangeRequests: deliveryChanges,
          ingredientOrders,
        },
      };
    });
    const [output, ordersDueNext] = await Promise.all([
      this.output.shiftOutput(user, org, base.today),
      this.dueNext.dueNext(user, org),
    ]);
    return { ...base, outputTotals: output.totals, ordersDueNext };
  }

  /** DSH-2: the employee's home: punch card, today's output, own tasks and My Orders, one call. */
  async home(user: AuthUser, org: OrgContext) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    const card = await this.shifts.card(user, org);
    const today = await this.db.run(dbContext(user, org), async (tx) =>
      localDate(
        (
          await tx.organization.findUniqueOrThrow({
            where: { id: org.organizationId },
            select: { timezone: true },
          })
        ).timezone,
      ),
    );
    const [output, tasks, myOrders, unread] = await Promise.all([
      this.output.getOutput(user, org, { from: today, to: today }),
      this.db.run(dbContext(user, org), (tx) =>
        tx.task.findMany({
          where: { organizationId: org.organizationId, assigneeId: user.userId, status: 'open' },
          select: { id: true, title: true, dueDate: true },
          orderBy: [{ dueDate: 'asc' }],
        }),
      ),
      org.actor === 'employee' && !org.employeeAccess.ordersDueNext
        ? Promise.resolve(null)
        : this.dueNext.forEmployee(user, org, user.userId),
      this.db.run({ organizationId: null, userId: user.userId }, (tx) =>
        tx.notification.count({ where: { userId: user.userId, readAt: null } }),
      ),
    ]);
    return {
      today,
      punchCard: card,
      output: output.days[0],
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate?.toISOString().slice(0, 10) ?? null,
      })),
      myOrders,
      unreadNotifications: unread,
    };
  }
}
