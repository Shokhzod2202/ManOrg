import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { hhmmToTime, localDate, timeToHhmm, zonedToUtc } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { switchOrganization, type Tx } from '../database/prisma-client';
import { NotificationsService } from '../notifications/notifications.service';
import {
  type ApproxTimeInput,
  type DeliveryChangeInput,
  type ListDeliveriesInput,
  type SaveDeliveryInput,
} from './deliveries.schemas';

const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

interface LineInput {
  productId: string;
  deliveredQuantity: number;
}

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ contractors and DTM

  /** DEL-2: the provider's approved contractors with their standing delivery time. */
  contractors(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const links = await tx.contractorLink.findMany({
        where: { organizationId: org.organizationId, status: 'approved' },
        include: { contractor: { select: { id: true, name: true } } },
      });
      const items = links
        .map((l) => ({ contractor: l.contractor, approxTime: approx(l) }))
        .sort((a, b) =>
          (a.approxTime?.start ?? '99:99').localeCompare(b.approxTime?.start ?? '99:99'),
        );
      return { items, nextCursor: null };
    });
  }

  /**
   * DTM-1 to DTM-3, DTM-6: one standing time per contractor, every day, until changed. A change
   * applies to deliveries from the next day on and to today's if not yet completed. Audited;
   * the contractor's admins and the provider's people are notified.
   */
  setApproxTime(user: AuthUser, org: OrgContext, contractorId: string, input: ApproxTimeInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const link = await this.link(tx, org, contractorId);
      const { timezone } = await this.provider(tx, org.organizationId);
      await tx.contractorLink.update({
        where: { id: link.id },
        data: {
          approxStart: hhmmToTime(input.start),
          approxEnd: hhmmToTime(input.end),
          version: { increment: 1 },
        },
      });
      const open = await tx.delivery.findMany({
        where: {
          organizationId: org.organizationId,
          contractorOrgId: contractorId,
          deliveryDate: { gte: dateOf(localDate(timezone)) },
          status: 'draft',
        },
      });
      for (const d of open) {
        const date = isoOf(d.deliveryDate);
        await tx.delivery.update({
          where: { id: d.id },
          data: {
            windowStart: zonedToUtc(date, input.start, timezone),
            windowEnd: zonedToUtc(date, input.end, timezone),
          },
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'contractor_link.approx_time_set',
        entity: 'contractor_link',
        entityId: link.id,
        before: { approxTime: approx(link) },
        after: { approxTime: input, draftDeliveriesUpdated: open.length },
      });
      const people = await tx.membership.findMany({
        where: { organizationId: org.organizationId, status: 'active' },
        select: { userId: true },
      });
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: [
          ...people.map((p) => p.userId),
          ...(await this.contractorAdmins(tx, contractorId, org.organizationId)),
        ],
        type: 'delivery.approx_time_changed',
        payload: { contractorId, start: input.start, end: input.end },
      });
      return { contractor: { id: contractorId }, approxTime: input };
    });
  }

  // ------------------------------------------------------------ delivery management (DEL-1 to DEL-4)

  /** DEL-2: the delivery for a contractor and day, or a draft preview built from that day's order. */
  getForDay(user: AuthUser, org: OrgContext, contractorId: string, date: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const link = await this.link(tx, org, contractorId);
      const existing = await this.find(tx, org.organizationId, contractorId, date);
      if (existing) return this.present(tx, existing.id);
      const order = await this.order(tx, org.organizationId, contractorId, date);
      const { timezone } = await this.provider(tx, org.organizationId);
      const time = approx(link);
      return {
        id: null,
        provider: { id: org.organizationId },
        contractor: { id: contractorId },
        deliveryDate: date,
        window: time
          ? {
              start: zonedToUtc(date, time.start, timezone),
              end: zonedToUtc(date, time.end, timezone),
              startTime: time.start,
              endTime: time.end,
            }
          : null,
        status: 'not_started',
        lines: (order?.lines ?? []).map((l) => ({
          productId: l.productId,
          productName: l.productName,
          orderedQuantity: l.quantity,
          deliveredQuantity: l.quantity,
          difference: 0,
          isUnordered: false,
        })),
        pendingChange: null,
        completedAt: null,
        confirmedAt: null,
        version: 0,
      };
    });
  }

  /** DEL-1, DEL-3, DEL-4: one delivery per contractor per day; edits only while it is a draft. */
  save(
    user: AuthUser,
    org: OrgContext,
    contractorId: string,
    date: string,
    input: SaveDeliveryInput,
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const link = await this.link(tx, org, contractorId);
      const { timezone } = await this.provider(tx, org.organizationId);
      let delivery = await this.find(tx, org.organizationId, contractorId, date);
      if (delivery && delivery.status !== 'draft') {
        throw Errors.conflict(
          'DELIVERY_LOCKED',
          'This delivery is completed; it changes only through an approved change request.',
        );
      }
      const order = await this.order(tx, org.organizationId, contractorId, date);
      const before = delivery
        ? await tx.deliveryLine.findMany({ where: { deliveryId: delivery.id } })
        : [];
      if (!delivery) {
        const time = approx(link);
        delivery = await tx.delivery.create({
          data: {
            organizationId: org.organizationId,
            contractorOrgId: contractorId,
            orderId: order?.id ?? null,
            deliveryDate: dateOf(date),
            windowStart: time ? zonedToUtc(date, time.start, timezone) : null,
            windowEnd: time ? zonedToUtc(date, time.end, timezone) : null,
          },
        });
      }
      const current = new Map(before.map((l) => [l.productId, l.deliveredQuantity]));
      await this.writeLines(tx, delivery, order?.lines ?? [], input.lines, current);
      await tx.delivery.update({ where: { id: delivery.id }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'delivery.save',
        entity: 'delivery',
        entityId: delivery.id,
        before: {
          lines: before.map((l) => ({ productId: l.productId, delivered: l.deliveredQuantity })),
        },
        after: { lines: input.lines },
      });
      return this.present(tx, delivery.id);
    });
  }

  complete(user: AuthUser, org: OrgContext, id: string) {
    return this.transition(
      user,
      org,
      id,
      'draft',
      'completed',
      'delivery.complete',
      async (tx, d) => {
        await this.notifications.notify(tx, {
          organizationId: org.organizationId,
          userIds: await this.contractorAdmins(tx, d.contractorOrgId, org.organizationId),
          type: 'delivery.completed',
          payload: { deliveryId: d.id, deliveryDate: isoOf(d.deliveryDate) },
        });
      },
    );
  }

  /** DEL-5: the contractor admin approves a completed delivery. */
  confirm(user: AuthUser, org: OrgContext, id: string) {
    return this.transition(
      user,
      org,
      id,
      'completed',
      'confirmed',
      'delivery.confirm',
      async () => undefined,
    );
  }

  /** DEL-6: after confirming, the contractor asks for a change; the delivery stays as it is. */
  requestChange(user: AuthUser, org: OrgContext, id: string, input: DeliveryChangeInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const d = await tx.delivery.findFirst({ where: { id, contractorOrgId: org.organizationId } });
      if (!d) throw Errors.notFound('Delivery');
      if (d.status !== 'confirmed') {
        throw Errors.conflict(
          'NOT_CONFIRMED',
          'Confirm the delivery first; a request can follow only a confirmed delivery.',
        );
      }
      await switchOrganization(tx, d.organizationId);
      const request = await tx.deliveryChangeRequest.create({
        data: {
          organizationId: d.organizationId,
          contractorOrgId: org.organizationId,
          deliveryId: d.id,
          requestedById: user.userId,
          payload: { lines: input.lines },
          reason: input.reason,
        },
      });
      await tx.delivery.update({
        where: { id: d.id },
        data: { status: 'change_requested', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: d.organizationId,
        actor: userActor(user.userId),
        action: 'delivery.change_request',
        entity: 'delivery',
        entityId: d.id,
        after: { requestId: request.id, lines: input.lines, reason: input.reason },
      });
      await this.notifications.notify(tx, {
        organizationId: d.organizationId,
        userIds: await this.notifications.admins(tx, d.organizationId),
        type: 'delivery.change_requested',
        payload: { deliveryId: d.id, requestId: request.id },
      });
      return this.present(tx, d.id);
    });
  }

  /** DEL-6: the provider admin approves (the delivery changes) or rejects (it stays). */
  decideChange(user: AuthUser, org: OrgContext, id: string, requestId: string, approve: boolean) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const d = await tx.delivery.findFirst({ where: { id, organizationId: org.organizationId } });
      if (!d) throw Errors.notFound('Delivery');
      const request = await tx.deliveryChangeRequest.findFirst({
        where: { id: requestId, deliveryId: id },
      });
      if (!request) throw Errors.notFound('Change request');
      const decided = await tx.deliveryChangeRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: approve ? 'approved' : 'rejected',
          decidedById: user.userId,
          decidedAt: new Date(),
        },
      });
      if (decided.count !== 1)
        throw Errors.conflict('NOT_PENDING', 'This request has already been decided.');
      const before = await tx.deliveryLine.findMany({ where: { deliveryId: id } });
      const lines = payloadLines(request.payload);
      if (approve) {
        const order = d.orderId
          ? await tx.order.findUnique({ where: { id: d.orderId }, include: { lines: true } })
          : null;
        await this.writeLines(
          tx,
          d,
          order?.lines ?? [],
          lines,
          new Map(before.map((l) => [l.productId, l.deliveredQuantity])),
        );
      }
      await tx.delivery.update({
        where: { id },
        data: { status: 'confirmed', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: approve ? 'delivery.change_approve' : 'delivery.change_reject',
        entity: 'delivery',
        entityId: id,
        before: {
          lines: before.map((l) => ({ productId: l.productId, delivered: l.deliveredQuantity })),
        },
        after: approve ? { lines } : { unchanged: true },
      });
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: await this.contractorAdmins(tx, d.contractorOrgId, org.organizationId),
        type: approve ? 'delivery.change_approved' : 'delivery.change_rejected',
        payload: { deliveryId: id },
      });
      return this.present(tx, id);
    });
  }

  /** Deliveries for a date range: the provider sees all contractors, a contractor its own. */
  list(user: AuthUser, org: OrgContext, input: ListDeliveriesInput) {
    const contractorSide = org.organizationType === 'contractor';
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.delivery.findMany({
        where: {
          ...(contractorSide
            ? { contractorOrgId: org.organizationId }
            : {
                organizationId: org.organizationId,
                ...(input.contractor_id ? { contractorOrgId: input.contractor_id } : {}),
              }),
          deliveryDate: { gte: dateOf(input.from), lte: dateOf(input.to) },
        },
        orderBy: [{ deliveryDate: 'asc' }, { windowStart: 'asc' }],
        select: { id: true },
      });
      return {
        items: await Promise.all(rows.map((r) => this.present(tx, r.id))),
        nextCursor: null,
      };
    });
  }

  get(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const d = await tx.delivery.findFirst({
        where: {
          id,
          OR: [{ organizationId: org.organizationId }, { contractorOrgId: org.organizationId }],
        },
        select: { id: true },
      });
      if (!d) throw Errors.notFound('Delivery');
      return this.present(tx, id);
    });
  }

  // ------------------------------------------------------------ helpers

  private async transition(
    user: AuthUser,
    org: OrgContext,
    id: string,
    from: 'draft' | 'completed',
    to: 'completed' | 'confirmed',
    action: string,
    after: (
      tx: Tx,
      d: { id: string; contractorOrgId: string; deliveryDate: Date },
    ) => Promise<void>,
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const side =
        to === 'confirmed'
          ? { contractorOrgId: org.organizationId }
          : { organizationId: org.organizationId };
      const d = await tx.delivery.findFirst({ where: { id, ...side } });
      if (!d) throw Errors.notFound('Delivery');
      const now = new Date();
      const result = await tx.delivery.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          ...(to === 'completed' ? { completedAt: now } : { confirmedAt: now }),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1)
        throw Errors.conflict('WRONG_STATUS', `Only a ${from} delivery can become ${to}.`);
      // The audit entry belongs to the provider's organization, also when the contractor confirms.
      if (d.organizationId !== org.organizationId) await switchOrganization(tx, d.organizationId);
      await this.audit.record(tx, {
        organizationId: d.organizationId,
        actor: userActor(user.userId),
        action,
        entity: 'delivery',
        entityId: id,
        before: { status: from },
        after: { status: to, at: now },
      });
      await after(tx, d);
      return this.present(tx, id);
    });
  }

  /** Ordered and delivered numbers stay separate; the difference is derived, never typed. */
  private async writeLines(
    tx: Tx,
    delivery: { id: string; organizationId: string; contractorOrgId: string },
    ordered: { productId: string; productName: string; quantity: number }[],
    given: LineInput[],
    current: Map<string, number>,
  ) {
    const orderedMap = new Map(ordered.map((l) => [l.productId, l]));
    const givenMap = new Map(given.map((l) => [l.productId, l.deliveredQuantity]));
    const extra = given.filter((l) => !orderedMap.has(l.productId)).map((l) => l.productId);
    const keptExtra = [...current.keys()].filter((p) => !orderedMap.has(p) && !givenMap.has(p));
    const products = await tx.product.findMany({
      where: {
        id: { in: [...extra, ...keptExtra] },
        organizationId: delivery.organizationId,
        deletedAt: null,
      },
      select: { id: true, name: true },
    });
    if (products.filter((p) => extra.includes(p.id)).length !== new Set(extra).size) {
      throw Errors.validation({
        lines: ['Every product must be one of this provider’s products.'],
      });
    }
    const names = new Map(products.map((p) => [p.id, p.name]));
    const rows = [
      ...ordered.map((l) => ({
        productId: l.productId,
        productName: l.productName,
        orderedQuantity: l.quantity,
        deliveredQuantity: givenMap.get(l.productId) ?? current.get(l.productId) ?? l.quantity,
        isUnordered: false,
      })),
      ...[...new Set([...extra, ...keptExtra])].map((productId) => ({
        productId,
        productName: names.get(productId) ?? '',
        orderedQuantity: 0,
        deliveredQuantity: givenMap.get(productId) ?? current.get(productId) ?? 0,
        isUnordered: true,
      })),
    ];
    await tx.deliveryLine.deleteMany({ where: { deliveryId: delivery.id } });
    if (rows.length > 0) {
      await tx.deliveryLine.createMany({
        data: rows.map((r) => ({
          ...r,
          organizationId: delivery.organizationId,
          contractorOrgId: delivery.contractorOrgId,
          deliveryId: delivery.id,
        })),
      });
    }
  }

  private async link(tx: Tx, org: OrgContext, contractorId: string) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    const link = await tx.contractorLink.findFirst({
      where: {
        organizationId: org.organizationId,
        contractorOrgId: contractorId,
        status: 'approved',
      },
    });
    if (!link) throw Errors.notFound('Contractor');
    return link;
  }

  private provider(tx: Tx, id: string) {
    return tx.organization.findUniqueOrThrow({ where: { id }, select: { timezone: true } });
  }

  private find(tx: Tx, providerId: string, contractorId: string, date: string) {
    return tx.delivery.findFirst({
      where: {
        organizationId: providerId,
        contractorOrgId: contractorId,
        deliveryDate: dateOf(date),
      },
    });
  }

  private order(tx: Tx, providerId: string, contractorId: string, date: string) {
    return tx.order.findFirst({
      where: {
        organizationId: providerId,
        contractorOrgId: contractorId,
        deliveryDate: dateOf(date),
        status: 'placed',
      },
      include: { lines: { orderBy: { productName: 'asc' } } },
    });
  }

  /** The contractor's admins: read in the contractor's organization, then back to the provider. */
  private async contractorAdmins(
    tx: Tx,
    contractorOrgId: string,
    providerId: string,
  ): Promise<string[]> {
    await switchOrganization(tx, contractorOrgId);
    const admins = await tx.membership.findMany({
      where: { organizationId: contractorOrgId, status: 'active', role: 'admin' },
      select: { userId: true },
    });
    await switchOrganization(tx, providerId);
    return admins.map((a) => a.userId);
  }

  async present(tx: Tx, id: string) {
    const d = await tx.delivery.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { orderBy: [{ isUnordered: 'asc' }, { productName: 'asc' }] },
        bakery: { select: { id: true, name: true } },
        contractor: { select: { id: true, name: true } },
        changeRequests: {
          where: { status: 'pending' },
          select: { id: true, payload: true, reason: true, createdAt: true },
        },
      },
    });
    const { timezone } = await this.provider(tx, d.organizationId).catch(() => ({
      timezone: 'Asia/Seoul',
    }));
    const local = (t: Date | null) =>
      t
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            hourCycle: 'h23',
            hour: '2-digit',
            minute: '2-digit',
          }).format(t)
        : null;
    const pending = d.changeRequests[0];
    return {
      id: d.id,
      provider: d.bakery,
      contractor: d.contractor,
      deliveryDate: isoOf(d.deliveryDate),
      window:
        d.windowStart && d.windowEnd
          ? {
              start: d.windowStart,
              end: d.windowEnd,
              startTime: local(d.windowStart),
              endTime: local(d.windowEnd),
            }
          : null,
      status: d.status,
      lines: d.lines.map((l) => ({
        productId: l.productId,
        productName: l.productName,
        orderedQuantity: l.orderedQuantity,
        deliveredQuantity: l.deliveredQuantity,
        difference: l.deliveredQuantity - l.orderedQuantity,
        isUnordered: l.isUnordered,
      })),
      pendingChange: pending
        ? {
            id: pending.id,
            lines: payloadLines(pending.payload),
            reason: pending.reason,
            createdAt: pending.createdAt,
          }
        : null,
      completedAt: d.completedAt,
      confirmedAt: d.confirmedAt,
      version: d.version,
    };
  }
}

const storedPayload = z.object({
  lines: z.array(z.object({ productId: z.string(), deliveredQuantity: z.number() })),
});

/** The lines a contractor asked for, as stored in delivery_change_requests.payload. */
function payloadLines(payload: unknown): LineInput[] {
  return storedPayload.parse(payload).lines;
}

function approx(link: { approxStart: Date | null; approxEnd: Date | null }) {
  return link.approxStart && link.approxEnd
    ? { start: timeToHhmm(link.approxStart), end: timeToHhmm(link.approxEnd) }
    : null;
}
