import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
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
  constructor(private readonly db: DatabaseService) {}

  /** TOD-1 to TOD-4: every contractor's order due next, by date then approximate time, with totals. */
  dueNext(user: AuthUser, org: OrgContext, contractorId?: string) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const orders = await this.select(tx, org.organizationId, contractorId);
      return { orders, totals: totals(orders.flatMap((o) => o.lines)) };
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
        select: { user: { select: { id: true, name: true } } },
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
      return { employee: member.user, orders, totals: totals(orders.flatMap((o) => o.lines)) };
    });
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
          lines: o.lines.map((l) => ({
            productId: l.productId,
            productName: l.productName,
            quantity: l.quantity,
          })),
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

/** TOD-4: totals match the sum of the orders due next. */
function totals(lines: { productId: string; productName: string; quantity: number }[]) {
  const map = new Map<string, { productId: string; productName: string; quantity: number }>();
  for (const l of lines) {
    const t = map.get(l.productId) ?? {
      productId: l.productId,
      productName: l.productName,
      quantity: 0,
    };
    t.quantity += l.quantity;
    map.set(l.productId, t);
  }
  return [...map.values()].sort((a, b) => a.productName.localeCompare(b.productName));
}
