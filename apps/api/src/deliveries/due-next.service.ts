import { PERSON, personOf, WORKS_SHIFTS } from '../common/memberships';
import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { addDays, localDate, timeToHhmm } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';

/** Deliveries in these states take an order off the lists (TOD-2). */
const DONE = ['completed', 'confirmed', 'change_requested'] as const;
/** How far back an undelivered order still counts as due (it stays until delivered). */
const LOOKBACK_DAYS = 14;
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Today's Orders and My Orders (TOD-1 to TOD-7, CLAUDE.md rule 8). "Next" means the order due
 * for delivery next, never the order dated tomorrow: for each contractor, its earliest placed
 * order whose delivery is not yet completed. The list depends only on that, so it does not change
 * at midnight and a night shift sees one stable list.
 */
@Injectable()
export class DueNextService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** TOD-1 to TOD-4: every contractor's order due next, by date then approximate time, with totals. */
  dueNext(user: AuthUser, org: OrgContext, contractorId?: string) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const orders = await this.select(tx, org.organizationId, contractorId);
      const result = board(orders, seesMoney(org));
      return { ...result, byEmployee: await this.byEmployee(tx, org, result.totals) };
    });
  }

  /**
   * TOD-5 to TOD-7: only the products assigned to the employee, each at the full quantity (the
   * admin splits shared work by hand). An employee opens their own; the admin opens anyone's.
   */
  forEmployee(user: AuthUser, org: OrgContext, employeeId: string) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    if (employeeId !== user.userId && org.actor !== 'org_admin' && org.actor !== 'bot')
      throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const member = await tx.membership.findFirst({
        where: { organizationId: org.organizationId, userId: employeeId, status: 'active' },
        select: PERSON,
      });
      if (!member) throw Errors.notFound('Employee');
      const assigned = new Set(
        (
          await tx.employeeProduct.findMany({
            where: { organizationId: org.organizationId, employeeId },
            select: { productId: true },
          })
        ).map((a) => a.productId),
      );
      const orders = (await this.select(tx, org.organizationId))
        .map((o) => ({ ...o, lines: o.lines.filter((l) => assigned.has(l.productId)) }))
        .filter((o) => o.lines.length > 0);
      return { employee: personOf(member), ...board(orders, seesMoney(org)) };
    });
  }

  /**
   * Ticks a product as made (or not) in the orders due next, for every contractor or one
   * (decided 2026-11-13). Audited; returns the updated board.
   */
  markMade(
    user: AuthUser,
    org: OrgContext,
    input: { productId: string; contractorId?: string; made: boolean },
  ) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const orders = await this.select(tx, org.organizationId, input.contractorId);
      const lines = orders.flatMap((o) => o.lines.filter((l) => l.productId === input.productId));
      if (lines.length === 0) throw Errors.notFound('Product in the orders due next');
      const now = new Date();
      for (const l of lines) {
        await tx.orderLine.update({
          where: { id: l.lineId },
          data: input.made
            ? { madeQuantity: l.quantity, madeById: user.userId, madeAt: now }
            : { madeQuantity: 0, madeById: null, madeAt: null },
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: input.made ? 'order.made' : 'order.not_made',
        entity: 'product',
        entityId: input.productId,
        before: { lines: lines.map((l) => ({ lineId: l.lineId, made: l.madeQuantity })) },
        after: {
          lines: lines.map((l) => ({ lineId: l.lineId, made: input.made ? l.quantity : 0 })),
        },
      });
      const updated = await this.select(tx, org.organizationId);
      return board(updated, seesMoney(org));
    });
  }

  /**
   * Decided 2026-11-30: the estimated value of each person's assigned products in the orders due
   * next. A shared product counts in full for everyone it is assigned to, like their quantities.
   */
  private async byEmployee(tx: Tx, org: OrgContext, totals: Total[]) {
    if (!seesMoney(org)) return [];
    const due = new Map(totals.map((t) => [t.productId, t]));
    const [assigned, members] = await Promise.all([
      tx.employeeProduct.findMany({
        where: { organizationId: org.organizationId, productId: { in: [...due.keys()] } },
        select: { employeeId: true, productId: true },
      }),
      tx.membership.findMany({
        // Employees, and admins switched on to work shifts (decided 2026-11-26).
        where: { organizationId: org.organizationId, status: 'active', ...WORKS_SHIFTS },
        select: PERSON,
      }),
    ]);
    const people = new Map(members.map((m) => [m.user.id, personOf(m)]));
    const sums = new Map<string, number>();
    for (const a of assigned) {
      if (!people.has(a.employeeId)) continue;
      sums.set(a.employeeId, (sums.get(a.employeeId) ?? 0) + (due.get(a.productId)?.amount ?? 0));
    }
    return [...sums.entries()]
      .map(([id, amount]) => ({ employee: people.get(id)!, amount }))
      .sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  }

  private async select(tx: Tx, providerId: string, contractorId?: string) {
    const { timezone } = await tx.organization.findUniqueOrThrow({
      where: { id: providerId },
      select: { timezone: true },
    });
    const since = new Date(`${addDays(localDate(timezone), -LOOKBACK_DAYS)}T00:00:00Z`);
    const [orders, done, links, deliveries] = await Promise.all([
      tx.order.findMany({
        where: {
          organizationId: providerId,
          status: 'placed',
          deliveryDate: { gte: since },
          ...(contractorId ? { contractorOrgId: contractorId } : {}),
        },
        include: {
          lines: { orderBy: { productName: 'asc' } },
          contractor: { select: { id: true, name: true } },
        },
        orderBy: [{ deliveryDate: 'asc' }],
      }),
      tx.delivery.findMany({
        where: {
          organizationId: providerId,
          deliveryDate: { gte: since },
          status: { in: [...DONE] },
        },
        select: { contractorOrgId: true, deliveryDate: true },
      }),
      tx.contractorLink.findMany({
        where: { organizationId: providerId, status: 'approved' },
        select: { contractorOrgId: true, approxStart: true, approxEnd: true },
      }),
      tx.delivery.findMany({
        where: { organizationId: providerId, deliveryDate: { gte: since } },
        select: {
          contractorOrgId: true,
          deliveryDate: true,
          windowStart: true,
          windowEnd: true,
          status: true,
          id: true,
        },
      }),
    ]);
    // Decided 2026-11-30: each line carries its product's place and type, so the board sorts
    // like the product list (custom, A to Z or by type).
    const products = new Map(
      (
        await tx.product.findMany({
          where: { organizationId: providerId },
          select: {
            id: true,
            sortOrder: true,
            type: { select: { name: true } },
            // Decided 2026-11-30: orders due next are not delivered yet, so their value is an
            // estimate at today's price; the delivery records the real amount (F-001 FIN-2, FIN-5).
            prices: {
              where: { effectiveFrom: { lte: new Date() } },
              orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
              take: 1,
              select: { unitPrice: true },
            },
          },
        })
      ).map((p) => [
        p.id,
        {
          sortOrder: p.sortOrder,
          typeName: p.type?.name ?? null,
          unitPrice: p.prices[0]?.unitPrice ?? null,
        },
      ]),
    );
    const isDone = new Set(done.map((d) => `${d.contractorOrgId}:${isoOf(d.deliveryDate)}`));
    const next = new Map<string, (typeof orders)[number]>();
    for (const o of orders) {
      if (isDone.has(`${o.contractorOrgId}:${isoOf(o.deliveryDate)}`)) continue;
      if (!next.has(o.contractorOrgId)) next.set(o.contractorOrgId, o);
    }
    const local = (t: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(t);
    return [...next.values()]
      .map((o) => {
        const date = isoOf(o.deliveryDate);
        const delivery = deliveries.find(
          (d) => d.contractorOrgId === o.contractorOrgId && isoOf(d.deliveryDate) === date,
        );
        const link = links.find((l) => l.contractorOrgId === o.contractorOrgId);
        // DTM-4: the delivery's own copy once it exists, else the contractor's standing time.
        const approxTime =
          delivery?.windowStart && delivery.windowEnd
            ? { start: local(delivery.windowStart), end: local(delivery.windowEnd) }
            : link?.approxStart && link.approxEnd
              ? { start: timeToHhmm(link.approxStart), end: timeToHhmm(link.approxEnd) }
              : null;
        return {
          orderId: o.id,
          contractor: o.contractor,
          deliveryDate: date,
          approxTime,
          deliveryStatus: delivery?.status ?? 'not_started',
          lines: o.lines.map((l) => {
            const unitPrice = products.get(l.productId)?.unitPrice ?? null;
            return {
              lineId: l.id,
              productId: l.productId,
              productName: l.productName,
              sortOrder: products.get(l.productId)?.sortOrder ?? 0,
              typeName: products.get(l.productId)?.typeName ?? null,
              quantity: l.quantity,
              madeQuantity: l.madeQuantity,
              unitPrice: unitPrice as number | null,
              amount: (unitPrice === null ? null : unitPrice * l.quantity) as number | null,
            };
          }),
        };
      })
      .sort(
        (a, b) =>
          a.deliveryDate.localeCompare(b.deliveryDate) ||
          (a.approxTime?.start ?? '99:99').localeCompare(b.approxTime?.start ?? '99:99') ||
          a.contractor.name.localeCompare(b.contractor.name),
      );
  }
}

type Line = {
  productId: string;
  productName: string;
  sortOrder: number;
  typeName: string | null;
  quantity: number;
  madeQuantity: number;
  unitPrice: number | null;
  amount: number | null;
};
type Total = Line & { done: boolean };

/** Prices are finance data: only people who may see finance get them (F-001, Employee access). */
function seesMoney(org: OrgContext) {
  return org.organizationType === 'provider' && orgCan(org, 'finance.view');
}

/**
 * The board: orders with each one's estimated value, product totals and the grand total. Without
 * finance access every amount is null.
 */
function board<O extends { lines: Line[] }>(orders: O[], money: boolean) {
  const shown = orders.map((o) => {
    const lines = money ? o.lines : o.lines.map((l) => ({ ...l, unitPrice: null, amount: null }));
    return {
      ...o,
      lines,
      amount: money ? lines.reduce((n, l) => n + (l.amount ?? 0), 0) : null,
    };
  });
  const t = totals(shown.flatMap((o) => o.lines));
  return {
    orders: shown,
    totals: t,
    amount: money ? t.reduce((n, x) => n + (x.amount ?? 0), 0) : null,
    unpriced: money ? t.filter((x) => x.unitPrice === null).length : 0,
  };
}

/** TOD-4: totals match the sum of the orders due next; made shows production progress. */
function totals(lines: Line[]): Total[] {
  const map = new Map<string, Total>();
  for (const l of lines) {
    const t = map.get(l.productId) ?? {
      productId: l.productId,
      productName: l.productName,
      sortOrder: l.sortOrder,
      typeName: l.typeName,
      quantity: 0,
      madeQuantity: 0,
      unitPrice: l.unitPrice,
      amount: l.unitPrice === null ? null : 0,
      done: false,
    };
    t.quantity += l.quantity;
    t.madeQuantity += l.madeQuantity;
    if (t.amount !== null) t.amount += l.amount ?? 0;
    t.done = t.madeQuantity >= t.quantity;
    map.set(l.productId, t);
  }
  return [...map.values()].sort((a, b) => a.productName.localeCompare(b.productName));
}
