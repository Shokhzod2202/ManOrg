import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { localDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { switchOrganization, type Tx } from '../database/prisma-client';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { defaultDeliveryDate, diffLines } from './order-dates';
import {
  type ChangeRequestInput,
  type ListOrdersInput,
  type PlaceOrderInput,
  type SetLinesInput,
} from './orders.schemas';

const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
/** Deliveries in these states close ordering for that day (decided 2026-11-13). */
const DONE_STATES = ['completed', 'confirmed', 'change_requested'] as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------ contractor side

  /** Providers that approved the calling contractor (ACC-6). */
  providers(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const links = await tx.contractorLink.findMany({
        where: { contractorOrgId: org.organizationId, status: 'approved' },
        include: { bakery: { select: { id: true, name: true, type: true } } },
        orderBy: { createdAt: 'asc' },
      });
      return { items: links.map((l) => l.bakery), nextCursor: null };
    });
  }

  /** ORD-1: the provider's available products. Unapproved contractors see nothing (ACC-6). */
  catalog(user: AuthUser, org: OrgContext, providerId: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.enterProvider(tx, org, providerId);
      const products = await tx.product.findMany({
        where: { organizationId: providerId, available: true, deletedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, imageUrl: true },
      });
      return {
        items: await Promise.all(
          products.map(async (p) => ({
            id: p.id,
            name: p.name,
            imageUrl: await this.storage.signedUrl(p.imageUrl),
          })),
        ),
        nextCursor: null,
      };
    });
  }

  defaultDate(user: AuthUser, org: OrgContext, providerId: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const provider = await this.enterProvider(tx, org, providerId);
      return { ...defaultDeliveryDate(provider.timezone), timezone: provider.timezone };
    });
  }

  /** ORD-2: one active order per contractor, provider and delivery date. */
  place(user: AuthUser, org: OrgContext, input: PlaceOrderInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const provider = await this.enterProvider(tx, org, input.providerId);
      const today = localDate(provider.timezone);
      if (input.deliveryDate < today) {
        throw Errors.validation({ deliveryDate: ['Choose today or a later day.'] });
      }
      if (input.deliveryDate === today)
        await this.assertTodayOpen(tx, provider.id, org.organizationId, today);
      const existing = await tx.order.findFirst({
        where: {
          organizationId: provider.id,
          contractorOrgId: org.organizationId,
          deliveryDate: dateOf(input.deliveryDate),
          status: 'placed',
        },
        select: { id: true },
      });
      if (existing) {
        throw Errors.conflict(
          'ORDER_EXISTS',
          'You already have an order for this day; send a change request instead.',
        );
      }
      const products = await this.availableProducts(
        tx,
        provider.id,
        input.lines.map((l) => l.productId),
      );
      const order = await tx.order.create({
        data: {
          organizationId: provider.id,
          contractorOrgId: org.organizationId,
          deliveryDate: dateOf(input.deliveryDate),
          placedById: user.userId,
          // organization_id and contractor_org_id come from the order through the composite key.
          lines: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              productName: products.get(l.productId)!,
              quantity: l.quantity,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        organizationId: provider.id,
        actor: userActor(user.userId),
        action: 'order.place',
        entity: 'order',
        entityId: order.id,
        after: { deliveryDate: input.deliveryDate, lines: input.lines },
      });
      await this.notifyProvider(tx, provider.id, 'order.placed', {
        orderId: order.id,
        deliveryDate: input.deliveryDate,
      });
      return this.present(tx, order.id);
    });
  }

  /**
   * ORD-3 (decided 2026-11-13): a contractor's edit never changes the order. It becomes a change
   * request with one item per product, which people at the provider accept or reject.
   */
  requestChange(user: AuthUser, org: OrgContext, orderId: string, input: ChangeRequestInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, contractorOrgId: org.organizationId },
        include: { lines: true },
      });
      if (!order) throw Errors.notFound('Order');
      if (order.status !== 'placed')
        throw Errors.conflict('ORDER_CANCELLED', 'This order is cancelled.');
      await switchOrganization(tx, order.organizationId);
      const delivery = await tx.delivery.findFirst({
        where: {
          organizationId: order.organizationId,
          contractorOrgId: org.organizationId,
          deliveryDate: order.deliveryDate,
          status: { in: [...DONE_STATES] },
        },
        select: { id: true },
      });
      if (delivery)
        throw Errors.conflict(
          'DELIVERY_DONE',
          'This delivery is completed; ask for a delivery change instead.',
        );
      const items = diffLines(order.lines, input.lines);
      if (items.length === 0) throw Errors.validation({ lines: ['Nothing changes.'] });
      const names = await this.availableProducts(
        tx,
        order.organizationId,
        items.filter((i) => i.kind === 'add' || i.kind === 'increase').map((i) => i.productId),
      );
      for (const l of order.lines) names.set(l.productId, l.productName);
      const request = await tx.orderChangeRequest.create({
        data: {
          organizationId: order.organizationId,
          contractorOrgId: org.organizationId,
          orderId: order.id,
          requestedById: user.userId,
          note: input.note ?? null,
          items: {
            create: items.map((i) => ({
              productId: i.productId,
              productName: names.get(i.productId) ?? '',
              fromQuantity: i.from,
              toQuantity: i.to,
              kind: i.kind,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        organizationId: order.organizationId,
        actor: userActor(user.userId),
        action: 'order.change_request',
        entity: 'order',
        entityId: order.id,
        after: { requestId: request.id, items },
      });
      await this.notifyProvider(tx, order.organizationId, 'order.change_requested', {
        orderId: order.id,
        requestId: request.id,
      });
      return this.presentRequest(tx, request.id);
    });
  }

  // ------------------------------------------------------------ provider side and shared reads

  /** Orders for a date range: the provider sees all contractors; a contractor sees its own. */
  list(user: AuthUser, org: OrgContext, input: ListOrdersInput) {
    const contractorSide = org.organizationType === 'contractor';
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.order.findMany({
        where: {
          ...(contractorSide
            ? { contractorOrgId: org.organizationId }
            : {
                organizationId: org.organizationId,
                ...(input.contractor_id ? { contractorOrgId: input.contractor_id } : {}),
              }),
          deliveryDate: { gte: dateOf(input.from), lte: dateOf(input.to) },
        },
        orderBy: [{ deliveryDate: 'asc' }, { placedAt: 'asc' }],
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
      const order = await tx.order.findFirst({
        where: {
          id,
          OR: [{ organizationId: org.organizationId }, { contractorOrgId: org.organizationId }],
        },
        select: { id: true },
      });
      if (!order) throw Errors.notFound('Order');
      return this.present(tx, id);
    });
  }

  /** ORD-4: totals per product for one delivery date, which feed that day's production plan. */
  totals(user: AuthUser, org: OrgContext, date: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const lines = await tx.orderLine.findMany({
        where: {
          organizationId: org.organizationId,
          order: { deliveryDate: dateOf(date), status: 'placed' },
        },
        select: { productId: true, productName: true, quantity: true },
      });
      const totals = new Map<string, { productId: string; name: string; quantity: number }>();
      for (const l of lines) {
        const t = totals.get(l.productId) ?? {
          productId: l.productId,
          name: l.productName,
          quantity: 0,
        };
        t.quantity += l.quantity;
        totals.set(l.productId, t);
      }
      return {
        deliveryDate: date,
        items: [...totals.values()].sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }

  /** The provider admin corrects an order directly; audited (orders.edit). */
  setLines(user: AuthUser, org: OrgContext, id: string, version: number, input: SetLinesInput) {
    if (org.organizationType !== 'provider')
      throw Errors.forbidden('Contractors change orders through change requests.');
    return this.db.run(dbContext(user, org), async (tx) => {
      const order = await tx.order.findFirst({
        where: { id, organizationId: org.organizationId },
        include: { lines: true },
      });
      if (!order) throw Errors.notFound('Order');
      if (order.version !== version) throw Errors.versionConflict();
      const names = await this.availableProducts(
        tx,
        org.organizationId,
        input.lines.map((l) => l.productId),
        true,
      );
      for (const l of order.lines) names.set(l.productId, l.productName);
      await this.replaceLines(tx, order, input.lines, names);
      const result = await tx.order.updateMany({
        where: { id, version },
        data: {
          version: { increment: 1 },
          status: input.lines.length === 0 ? 'cancelled' : 'placed',
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'order.edit',
        entity: 'order',
        entityId: id,
        before: {
          lines: order.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        },
        after: { lines: input.lines },
      });
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: await this.contractorAdmins(tx, order.contractorOrgId),
        type: 'order.edited',
        payload: { orderId: id },
      });
      return this.present(tx, id);
    });
  }

  /** Open change requests: everyone at the provider who sees orders; a contractor sees its own. */
  listChangeRequests(user: AuthUser, org: OrgContext, status: 'open' | 'closed') {
    const contractorSide = org.organizationType === 'contractor';
    if (!contractorSide && !orgCan(org, 'orders.readDueNext')) throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.orderChangeRequest.findMany({
        where: {
          status,
          ...(contractorSide
            ? { contractorOrgId: org.organizationId }
            : { organizationId: org.organizationId }),
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      return {
        items: await Promise.all(rows.map((r) => this.presentRequest(tx, r.id))),
        nextCursor: null,
      };
    });
  }

  /**
   * Accept or reject one product change (decided 2026-11-13). Additions and increases: any
   * employee or admin. Decreases and removals: the admin only. Accepting applies it to the order.
   */
  decideItem(user: AuthUser, org: OrgContext, itemId: string, accept: boolean) {
    if (org.organizationType !== 'provider') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      const item = await tx.orderChangeItem.findFirst({
        where: { id: itemId, organizationId: org.organizationId },
        include: { request: true },
      });
      if (!item) throw Errors.notFound('Change');
      const growing = item.kind === 'add' || item.kind === 'increase';
      const allowed = growing ? orgCan(org, 'orders.acceptAdditions') : orgCan(org, 'orders.edit');
      if (!allowed)
        throw Errors.forbidden(
          'Only an admin can accept or reject a smaller quantity or a removed product.',
        );
      const decided = await tx.orderChangeItem.updateMany({
        where: { id: itemId, status: 'pending' },
        data: {
          status: accept ? 'accepted' : 'rejected',
          decidedById: user.userId,
          decidedAt: new Date(),
        },
      });
      if (decided.count !== 1)
        throw Errors.conflict('NOT_PENDING', 'This change has already been decided.');
      const order = await tx.order.findUniqueOrThrow({
        where: { id: item.request.orderId },
        include: { lines: true },
      });
      if (accept) {
        const lines = order.lines
          .filter((l) => l.productId !== item.productId)
          .map((l) => ({ productId: l.productId, quantity: l.quantity }));
        if (item.toQuantity > 0)
          lines.push({ productId: item.productId, quantity: item.toQuantity });
        const names = new Map(order.lines.map((l) => [l.productId, l.productName]));
        names.set(item.productId, item.productName);
        await this.replaceLines(tx, order, lines, names);
        await tx.order.update({
          where: { id: order.id },
          data: { version: { increment: 1 }, status: lines.length === 0 ? 'cancelled' : 'placed' },
        });
      }
      const pending = await tx.orderChangeItem.count({
        where: { requestId: item.requestId, status: 'pending' },
      });
      if (pending === 0)
        await tx.orderChangeRequest.update({
          where: { id: item.requestId },
          data: { status: 'closed' },
        });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: accept ? 'order.change_accept' : 'order.change_reject',
        entity: 'order',
        entityId: order.id,
        before: { productId: item.productId, quantity: item.fromQuantity },
        after: {
          productId: item.productId,
          quantity: accept ? item.toQuantity : item.fromQuantity,
          kind: item.kind,
        },
      });
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: await this.contractorAdmins(tx, order.contractorOrgId),
        type: accept ? 'order.change_accepted' : 'order.change_rejected',
        payload: { orderId: order.id, product: item.productName, quantity: item.toQuantity },
      });
      return this.presentRequest(tx, item.requestId);
    });
  }

  // ------------------------------------------------------------ helpers

  /**
   * Moves a contractor's transaction into the provider's organization after checking the provider
   * approved this contractor. Only catalogue and own-order rows are read there.
   */
  private async enterProvider(tx: Tx, org: OrgContext, providerId: string) {
    if (org.organizationType !== 'contractor') throw Errors.forbidden();
    const link = await tx.contractorLink.findFirst({
      where: {
        organizationId: providerId,
        contractorOrgId: org.organizationId,
        status: 'approved',
      },
      select: { id: true },
    });
    if (!link) throw Errors.notFound('Provider');
    await switchOrganization(tx, providerId);
    return tx.organization.findUniqueOrThrow({
      where: { id: providerId },
      select: { id: true, timezone: true },
    });
  }

  private async assertTodayOpen(tx: Tx, providerId: string, contractorId: string, today: string) {
    const done = await tx.delivery.findFirst({
      where: {
        organizationId: providerId,
        contractorOrgId: contractorId,
        deliveryDate: dateOf(today),
        status: { in: [...DONE_STATES] },
      },
      select: { id: true },
    });
    if (done)
      throw Errors.conflict(
        'DELIVERY_DONE',
        "Today's delivery is already completed; order for another day.",
      );
  }

  /** Product names by id; refuses products that are not the provider's or not available. */
  private async availableProducts(
    tx: Tx,
    providerId: string,
    ids: string[],
    includeUnavailable = false,
  ) {
    const unique = [...new Set(ids)];
    const rows = await tx.product.findMany({
      where: {
        id: { in: unique },
        organizationId: providerId,
        deletedAt: null,
        ...(includeUnavailable ? {} : { available: true }),
      },
      select: { id: true, name: true },
    });
    if (rows.length !== unique.length) {
      const ok = new Set(rows.map((r) => r.id));
      throw Errors.validation({
        lines: unique.filter((id) => !ok.has(id)).map((id) => `${id} is not available to order.`),
      });
    }
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async replaceLines(
    tx: Tx,
    order: { id: string; organizationId: string; contractorOrgId: string },
    lines: { productId: string; quantity: number }[],
    names: Map<string, string>,
  ) {
    await tx.orderLine.deleteMany({ where: { orderId: order.id } });
    if (lines.length > 0) {
      await tx.orderLine.createMany({
        data: lines.map((l) => ({
          organizationId: order.organizationId,
          contractorOrgId: order.contractorOrgId,
          orderId: order.id,
          productId: l.productId,
          productName: names.get(l.productId) ?? '',
          quantity: l.quantity,
        })),
      });
    }
  }

  /** New orders and change requests go to everyone at the provider (decided 2026-11-13). */
  private async notifyProvider(
    tx: Tx,
    providerId: string,
    type: string,
    payload: Record<string, string>,
  ) {
    const members = await tx.membership.findMany({
      where: { organizationId: providerId, status: 'active' },
      select: { userId: true },
    });
    await this.notifications.notify(tx, {
      organizationId: providerId,
      userIds: members.map((m) => m.userId),
      type,
      payload,
    });
  }

  /**
   * The contractor's admins. Their memberships belong to the contractor organization, so the
   * transaction looks there briefly and returns to the provider.
   */
  private async contractorAdmins(tx: Tx, contractorOrgId: string): Promise<string[]> {
    const current = await tx.$queryRaw<
      { org: string }[]
    >`SELECT current_setting('app.organization_id', true) AS org`;
    await switchOrganization(tx, contractorOrgId);
    const admins = await tx.membership.findMany({
      where: { organizationId: contractorOrgId, status: 'active', role: 'admin' },
      select: { userId: true },
    });
    await switchOrganization(tx, current[0]?.org ?? '');
    return admins.map((a) => a.userId);
  }

  async present(tx: Tx, id: string) {
    const o = await tx.order.findUniqueOrThrow({
      where: { id },
      include: {
        lines: { orderBy: { productName: 'asc' } },
        bakery: { select: { id: true, name: true } },
        contractor: { select: { id: true, name: true } },
        changeRequests: { where: { status: 'open' }, select: { id: true } },
      },
    });
    return {
      id: o.id,
      provider: o.bakery,
      contractor: o.contractor,
      deliveryDate: isoOf(o.deliveryDate),
      status: o.status,
      placedAt: o.placedAt,
      lines: o.lines.map((l) => ({
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
      })),
      openChangeRequestIds: o.changeRequests.map((r) => r.id),
      version: o.version,
    };
  }

  private async presentRequest(tx: Tx, id: string) {
    const r = await tx.orderChangeRequest.findUniqueOrThrow({
      where: { id },
      include: {
        items: { orderBy: { productName: 'asc' } },
        order: { select: { deliveryDate: true, contractor: { select: { id: true, name: true } } } },
      },
    });
    return {
      id: r.id,
      orderId: r.orderId,
      contractor: r.order.contractor,
      deliveryDate: isoOf(r.order.deliveryDate),
      note: r.note,
      status: r.status,
      items: r.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        productName: i.productName,
        fromQuantity: i.fromQuantity,
        toQuantity: i.toQuantity,
        kind: i.kind,
        status: i.status,
        needsAdmin: i.kind === 'decrease' || i.kind === 'remove',
        decidedAt: i.decidedAt,
      })),
      createdAt: r.createdAt,
    };
  }
}
