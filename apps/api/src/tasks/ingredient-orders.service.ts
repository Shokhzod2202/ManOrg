import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { localDate, localTime, timeToHhmm, weekdayIn } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { packPriceAt } from '../ingredients/ingredients.service';
import { NotificationsService } from '../notifications/notifications.service';
import { type CreateIngredientOrderInput } from './tasks.schemas';

type Step = 'fulfil' | 'check';

/** ING-5 to ING-7: employees order ingredients to the admin; each order is an admin task. */
@Injectable()
export class IngredientOrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('IngredientOrders');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** ING-5: the order arrives as a task for the admins and keeps the price in force now. */
  create(user: AuthUser, org: OrgContext, input: CreateIngredientOrderInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const ingredient = await tx.ingredient.findFirst({
        where: { id: input.ingredientId, organizationId: org.organizationId, deletedAt: null },
      });
      if (!ingredient) throw Errors.validation({ ingredientId: ['Not an ingredient here.'] });
      const requester = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { name: true },
      });
      const task = await tx.task.create({
        data: {
          organizationId: org.organizationId,
          assigneeId: null,
          createdById: user.userId,
          taskType: 'ingredient_order',
          title: `Order ${input.quantity} pack${input.quantity === 1 ? '' : 's'} of ${ingredient.name}`,
          description: [`Requested by ${requester.name}. Source: ${ingredient.source}.`, input.note]
            .filter(Boolean)
            .join('\n'),
        },
      });
      const order = await tx.ingredientOrder.create({
        data: {
          organizationId: org.organizationId,
          ingredientId: ingredient.id,
          requestedById: user.userId,
          quantity: input.quantity,
          packPrice: await packPriceAt(tx, ingredient.id, new Date()),
          note: input.note ?? null,
          taskId: task.id,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'ingredient_order.create',
        entity: 'ingredient_order',
        entityId: order.id,
        after: order,
      });
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: await this.notifications.admins(tx, org.organizationId),
        type: 'ingredient.ordered',
        payload: {
          ingredientOrderId: order.id,
          taskId: task.id,
          ingredient: ingredient.name,
          quantity: input.quantity,
        },
      });
      return this.present(tx, org, order.id);
    });
  }

  /** Admins and the bot see every order; an employee sees their own. */
  list(user: AuthUser, org: OrgContext, status?: 'requested' | 'fulfilled' | 'checked') {
    const all = orgCan(org, 'ingredients.fulfil');
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.ingredientOrder.findMany({
        where: {
          organizationId: org.organizationId,
          ...(status ? { status } : {}),
          ...(all ? {} : { requestedById: user.userId }),
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        take: 500,
      });
      return {
        items: await Promise.all(rows.map((r) => this.present(tx, org, r.id))),
        nextCursor: null,
      };
    });
  }

  /** ING-6: requested, then fulfilled, then checked; each step records who and when. */
  advance(user: AuthUser, org: OrgContext, id: string, step: Step) {
    const from = step === 'fulfil' ? 'requested' : 'fulfilled';
    const to = step === 'fulfil' ? 'fulfilled' : 'checked';
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.ingredientOrder.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!before) throw Errors.notFound('Ingredient order');
      const now = new Date();
      const result = await tx.ingredientOrder.updateMany({
        where: { id, status: from },
        data:
          step === 'fulfil'
            ? {
                status: to,
                fulfilledById: user.userId,
                fulfilledAt: now,
                version: { increment: 1 },
              }
            : { status: to, checkedById: user.userId, checkedAt: now, version: { increment: 1 } },
      });
      if (result.count !== 1) {
        throw Errors.conflict('WRONG_STATUS', `Only a ${from} order can be marked ${to}.`);
      }
      if (step === 'check' && before.taskId) {
        await tx.task.update({
          where: { id: before.taskId },
          data: {
            status: 'done',
            completedAt: now,
            completedById: user.userId,
            version: { increment: 1 },
          },
        });
      }
      const after = await tx.ingredientOrder.findUniqueOrThrow({ where: { id } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: `ingredient_order.${step}`,
        entity: 'ingredient_order',
        entityId: id,
        before,
        after,
      });
      if (step === 'fulfil') {
        await this.notifications.notify(tx, {
          organizationId: org.organizationId,
          userIds: [before.requestedById],
          type: 'ingredient.fulfilled',
          payload: { ingredientOrderId: id },
        });
      }
      return this.present(tx, org, id);
    });
  }

  /**
   * ING-7: when an ingredient's weekly ordering time comes, its responsible employees get one
   * notification for that day. Called by the reminder timer; safe to call repeatedly.
   */
  async sendDueReminders(now = new Date()): Promise<number> {
    let sent = 0;
    // The job reads each organization inside its own tenant context.
    const organizations = await this.listOrganizations();
    for (const org of organizations) {
      sent += await this.db.run({ organizationId: org.id, userId: null }, async (tx) => {
        const weekday = weekdayIn(org.timezone, now);
        const time = localTime(org.timezone, now);
        const date = localDate(org.timezone, now);
        const due = await tx.ingredient.findMany({
          where: {
            organizationId: org.id,
            deletedAt: null,
            orderScheduleDay: weekday,
            orderScheduleTime: { not: null },
          },
          include: { responsibilities: { select: { employeeId: true } } },
        });
        let count = 0;
        for (const ingredient of due) {
          if (timeToHhmm(ingredient.orderScheduleTime!) > time) continue;
          await this.notifications.notify(tx, {
            organizationId: org.id,
            userIds: ingredient.responsibilities.map((r) => r.employeeId),
            type: 'ingredient.due',
            payload: { ingredientId: ingredient.id, name: ingredient.name, date },
            dedupeKey: `ingredient.due:${ingredient.id}:${date}`,
          });
          count += ingredient.responsibilities.length;
        }
        return count;
      });
    }
    return sent;
  }

  /** Every provider organization, read through the pool policy as a system user. */
  private async listOrganizations() {
    return this.db.run({ organizationId: null, userId: SYSTEM_USER }, (tx) =>
      tx.organization.findMany({
        where: { type: 'provider' },
        select: { id: true, timezone: true },
      }),
    );
  }

  onModuleInit(): void {
    if (process.env.JOBS_ENABLED !== 'true') return;
    this.timer = setInterval(() => {
      this.sendDueReminders().catch((error: unknown) =>
        this.logger.error(
          'Ingredient reminders failed',
          error instanceof Error ? error.stack : undefined,
        ),
      );
    }, 5 * 60_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async present(tx: Tx, org: OrgContext, id: string) {
    const o = await tx.ingredientOrder.findUniqueOrThrow({
      where: { id },
      include: {
        ingredient: {
          select: { id: true, name: true, source: true, packQuantity: true, packUnit: true },
        },
      },
    });
    const ids = [o.requestedById, o.fulfilledById, o.checkedById].filter((x): x is string => !!x);
    const people = await tx.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const person = (pid: string | null) =>
      pid ? (people.find((p) => p.id === pid) ?? null) : null;
    return {
      id: o.id,
      ingredient: {
        id: o.ingredient.id,
        name: o.ingredient.name,
        source: o.ingredient.source,
        packQuantity: Number(o.ingredient.packQuantity.toString()),
        packUnit: o.ingredient.packUnit,
      },
      quantity: o.quantity,
      ...(orgCan(org, 'ingredients.readPrices') ? { packPrice: o.packPrice } : {}),
      note: o.note,
      status: o.status,
      requestedBy: person(o.requestedById),
      fulfilledBy: person(o.fulfilledById),
      fulfilledAt: o.fulfilledAt,
      checkedBy: person(o.checkedById),
      checkedAt: o.checkedAt,
      taskId: o.taskId,
      createdAt: o.createdAt,
    };
  }
}

/** Placeholder identity for scheduled jobs; organizations are readable by any signed-in user. */
const SYSTEM_USER = '00000000-0000-4000-8000-000000000000';
