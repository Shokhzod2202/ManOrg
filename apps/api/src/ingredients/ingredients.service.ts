import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { activeMembers } from '../common/memberships';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { hhmmToTime, timeToHhmm, weekdayIn } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { type Prisma } from '../generated/prisma/client';
import {
  type CreateIngredientInput,
  type SetAssigneesInput,
  type SetPriceInput,
  type UpdateIngredientInput,
} from './ingredients.schemas';

const include = (now: Date) =>
  ({
    prices: {
      where: { effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: 1,
      select: { packPrice: true, effectiveFrom: true },
    },
    assignments: { select: { employeeId: true } },
  }) satisfies Prisma.IngredientInclude;

type Row = {
  id: string;
  name: string;
  source: string;
  orderScheduleDay: number | null;
  orderScheduleTime: Date | null;
  packQuantity: { toString(): string };
  packUnit: 'g' | 'kg' | 'pc' | 'L' | 'mL';
  version: number;
  createdAt: Date;
  prices: { packPrice: number; effectiveFrom: Date }[];
  assignments: { employeeId: string }[];
};

interface ViewContext {
  showPrices: boolean;
  me: string;
  todayWeekday: number;
  names: Map<string, string>;
}

/** The current price per pack, or null; the price in force at `at` for past calculations. */
export async function packPriceAt(tx: Tx, ingredientId: string, at: Date): Promise<number | null> {
  const row = await tx.ingredientPrice.findFirst({
    where: { ingredientId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select: { packPrice: true },
  });
  return row?.packPrice ?? null;
}

function present(row: Row, view: ViewContext) {
  const packQuantity = Number(row.packQuantity.toString());
  const current = row.prices[0];
  const responsible = row.assignments.map((a) => ({
    id: a.employeeId,
    name: view.names.get(a.employeeId) ?? '',
  }));
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    orderSchedule:
      row.orderScheduleDay !== null && row.orderScheduleTime
        ? { weekday: row.orderScheduleDay, time: timeToHhmm(row.orderScheduleTime) }
        : null,
    packQuantity,
    packUnit: row.packUnit,
    ...(view.showPrices
      ? {
          packPrice: current?.packPrice ?? null,
          unitPrice: current ? Math.round((current.packPrice / packQuantity) * 100) / 100 : null,
          priceEffectiveFrom: current?.effectiveFrom ?? null,
        }
      : {}),
    responsibleEmployees: responsible,
    isMyResponsibility: row.assignments.some((a) => a.employeeId === view.me),
    dueToday: row.orderScheduleDay === view.todayWeekday,
    version: row.version,
    createdAt: row.createdAt,
  };
}

/** ING-1 to ING-4 and ING-8: the ingredient database used for ordering. */
@Injectable()
export class IngredientsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Every employee can see every ingredient (ING-4); the caller's own responsibilities come first.
   * Prices show only to those allowed to read them (open question 17, Employee access).
   */
  list(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const now = new Date();
      const rows = await tx.ingredient.findMany({
        where: { organizationId: org.organizationId, deletedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: include(now),
      });
      const view = await this.view(tx, user, org, rows);
      const items = rows
        .map((r) => present(r, view))
        .sort((a, b) => Number(b.isMyResponsibility) - Number(a.isMyResponsibility));
      // An organization's ingredient list is short; it is returned as one page.
      return { items, nextCursor: null };
    });
  }

  get(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const row = await this.find(tx, org, id);
      return present(row, await this.view(tx, user, org, [row]));
    });
  }

  create(user: AuthUser, org: OrgContext, input: CreateIngredientInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const ingredient = await tx.ingredient.create({
        data: {
          organizationId: org.organizationId,
          name: input.name,
          source: input.source,
          orderScheduleDay: input.orderSchedule?.weekday ?? null,
          orderScheduleTime: input.orderSchedule ? hhmmToTime(input.orderSchedule.time) : null,
          packQuantity: input.packQuantity,
          packUnit: input.packUnit,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'ingredient.create',
        entity: 'ingredient',
        entityId: ingredient.id,
        after: ingredient,
      });
      if (input.packPrice !== undefined) {
        await this.addPrice(tx, user, org, ingredient.id, input.packPrice, null);
      }
      const row = await this.find(tx, org, ingredient.id);
      return present(row, await this.view(tx, user, org, [row]));
    });
  }

  update(
    user: AuthUser,
    org: OrgContext,
    id: string,
    version: number,
    input: UpdateIngredientInput,
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.find(tx, org, id);
      if (before.version !== version) throw Errors.versionConflict();
      const result = await tx.ingredient.updateMany({
        where: { id, version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.orderSchedule !== undefined
            ? {
                orderScheduleDay: input.orderSchedule?.weekday ?? null,
                orderScheduleTime: input.orderSchedule
                  ? hhmmToTime(input.orderSchedule.time)
                  : null,
              }
            : {}),
          ...(input.packQuantity !== undefined ? { packQuantity: input.packQuantity } : {}),
          ...(input.packUnit !== undefined ? { packUnit: input.packUnit } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      const after = await this.find(tx, org, id);
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'ingredient.update',
        entity: 'ingredient',
        entityId: id,
        before: { ...before, prices: undefined, assignments: undefined },
        after: { ...after, prices: undefined, assignments: undefined },
      });
      return present(after, await this.view(tx, user, org, [after]));
    });
  }

  /**
   * A price change adds a history row effective now, so it changes only future calculations
   * (decided 2026-11-12). Past rows are never edited.
   */
  setPrice(user: AuthUser, org: OrgContext, id: string, input: SetPriceInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.find(tx, org, id);
      const previous = await packPriceAt(tx, id, new Date());
      await this.addPrice(tx, user, org, id, input.packPrice, previous);
      const row = await this.find(tx, org, id);
      return present(row, await this.view(tx, user, org, [row]));
    });
  }

  prices(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.find(tx, org, id);
      const rows = await tx.ingredientPrice.findMany({
        where: { ingredientId: id },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, packPrice: true, effectiveFrom: true, createdById: true },
      });
      return { items: rows, nextCursor: null };
    });
  }

  /** ING-4: the employees responsible for ordering this ingredient; replaces the whole list. */
  setAssignees(user: AuthUser, org: OrgContext, id: string, input: SetAssigneesInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.find(tx, org, id);
      await activeMembers(tx, org.organizationId, input.employeeIds);
      const wanted = [...new Set(input.employeeIds)];
      await tx.ingredientAssignment.deleteMany({ where: { ingredientId: id } });
      if (wanted.length > 0) {
        await tx.ingredientAssignment.createMany({
          data: wanted.map((employeeId) => ({
            organizationId: org.organizationId,
            ingredientId: id,
            employeeId,
          })),
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'ingredient.assignees_set',
        entity: 'ingredient',
        entityId: id,
        before: { employeeIds: before.assignments.map((a) => a.employeeId).sort() },
        after: { employeeIds: [...wanted].sort() },
      });
      const row = await this.find(tx, org, id);
      return present(row, await this.view(tx, user, org, [row]));
    });
  }

  private async addPrice(
    tx: Tx,
    user: AuthUser,
    org: OrgContext,
    ingredientId: string,
    packPrice: number,
    previous: number | null,
  ) {
    const price = await tx.ingredientPrice.create({
      data: {
        organizationId: org.organizationId,
        ingredientId,
        packPrice,
        createdById: user.userId,
      },
    });
    await this.audit.record(tx, {
      organizationId: org.organizationId,
      actor: userActor(user.userId),
      action: 'ingredient.price_set',
      entity: 'ingredient',
      entityId: ingredientId,
      before: previous === null ? null : { packPrice: previous },
      after: { packPrice, effectiveFrom: price.effectiveFrom, priceId: price.id },
    });
  }

  private async find(tx: Tx, org: OrgContext, id: string): Promise<Row> {
    const row = await tx.ingredient.findFirst({
      where: { id, organizationId: org.organizationId, deletedAt: null },
      include: include(new Date()),
    });
    if (!row) throw Errors.notFound('Ingredient');
    return row;
  }

  private async view(tx: Tx, user: AuthUser, org: OrgContext, rows: Row[]): Promise<ViewContext> {
    const ids = [...new Set(rows.flatMap((r) => r.assignments.map((a) => a.employeeId)))];
    const [users, organization] = await Promise.all([
      ids.length > 0
        ? tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      tx.organization.findUniqueOrThrow({
        where: { id: org.organizationId },
        select: { timezone: true },
      }),
    ]);
    return {
      showPrices: orgCan(org, 'ingredients.readPrices'),
      me: user.userId,
      todayWeekday: weekdayIn(organization.timezone),
      names: new Map(users.map((u) => [u.id, u.name])),
    };
  }
}
