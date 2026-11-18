import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { addDays, localDate } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { switchOrganization, type Tx } from '../database/prisma-client';
import { type Prisma } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { CONTENT_TYPES, newKey, sniffProof } from '../storage/storage-keys';
import { inClosedPeriod } from './pricing';
import { type ApproveInput, type ReallocateInput, type ScheduleInput } from './finance.schemas';

/** Deliveries whose value counts: done by the bakery (F-001 rule 1). */
const VALUED = ['completed', 'confirmed', 'change_requested'] as const;
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

interface Pair {
  providerId: string;
  contractorId: string;
}

/**
 * F-001: delivery-based money. Amounts come from delivered quantities and the prices copied onto
 * delivery lines; only approved payments move the official balance; closed settlement periods are
 * never recalculated; every payment and schedule action is audited.
 *
 * The bakery admin works in the bakery (organization_id); the contractor admin in its own
 * organization (contractor_org_id) and names the bakery, since it may buy from several.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------ who and what

  /** The bakery and contractor a request is about; a contractor only ever sees itself. */
  private async pair(
    tx: Tx,
    org: OrgContext,
    q: { contractor_id?: string; provider_id?: string },
  ): Promise<Pair> {
    if (org.organizationType === 'contractor') {
      if (!q.provider_id) throw Errors.validation({ provider_id: ['Choose the bakery.'] });
      const link = await tx.contractorLink.findFirst({
        where: {
          organizationId: q.provider_id,
          contractorOrgId: org.organizationId,
          status: 'approved',
        },
      });
      if (!link) throw Errors.notFound('Bakery');
      return { providerId: q.provider_id, contractorId: org.organizationId };
    }
    if (!q.contractor_id) throw Errors.validation({ contractor_id: ['Choose the contractor.'] });
    const link = await tx.contractorLink.findFirst({
      where: {
        organizationId: org.organizationId,
        contractorOrgId: q.contractor_id,
        status: 'approved',
      },
    });
    if (!link) throw Errors.notFound('Contractor');
    return { providerId: org.organizationId, contractorId: q.contractor_id };
  }

  /** Like pair(), but a bakery admin who names no contractor gets every contractor (AFD-6). */
  private async scope(
    tx: Tx,
    org: OrgContext,
    q: { contractor_id?: string; provider_id?: string },
  ): Promise<Pair[]> {
    if (org.organizationType === 'provider' && !q.contractor_id) {
      return (await this.contractorsOf(tx, org.organizationId)).map((c) => ({
        providerId: org.organizationId,
        contractorId: c.id,
      }));
    }
    return [await this.pair(tx, org, q)];
  }

  private async names(tx: Tx, ids: string[]) {
    const rows = await tx.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  private async contractorsOf(tx: Tx, providerId: string) {
    const links = await tx.contractorLink.findMany({
      where: { organizationId: providerId, status: 'approved' },
      include: { contractor: { select: { id: true, name: true } } },
    });
    return links.map((l) => l.contractor).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Today in the bakery's time zone. */
  todayFor(user: AuthUser, org: OrgContext): Promise<string> {
    return this.db.run(dbContext(user, org), (tx) => this.today(tx, org.organizationId));
  }

  private async today(tx: Tx, providerId: string): Promise<string> {
    const o = await tx.organization.findUnique({
      where: { id: providerId },
      select: { timezone: true },
    });
    return localDate(o?.timezone ?? 'Asia/Seoul');
  }

  // ------------------------------------------------------------------ sums (F-001 rules 1, 2)

  private async sums(tx: Tx, p: Pair, range: { from?: string; to?: string; before?: string }) {
    const dates = (field: 'deliveryDate' | 'paymentDate' | 'effectiveDate') => ({
      [field]: {
        ...(range.from ? { gte: day(range.from) } : {}),
        ...(range.to ? { lte: day(range.to) } : {}),
        ...(range.before ? { lt: day(range.before) } : {}),
      },
    });
    const base = { organizationId: p.providerId, contractorOrgId: p.contractorId };
    const [delivered, approved, pending, adjustments] = await Promise.all([
      tx.delivery.aggregate({
        where: { ...base, status: { in: [...VALUED] }, ...dates('deliveryDate') },
        _sum: { totalValue: true },
      }),
      tx.payment.aggregate({
        where: { ...base, status: 'approved', ...dates('paymentDate') },
        _sum: { approvedAmount: true },
      }),
      tx.payment.aggregate({
        where: { ...base, status: 'pending' },
        _sum: { submittedAmount: true },
      }),
      tx.balanceAdjustment.aggregate({
        where: { ...base, ...dates('effectiveDate') },
        _sum: { amount: true },
      }),
    ]);
    return {
      deliveredValue: delivered._sum.totalValue ?? 0,
      approvedPayments: approved._sum.approvedAmount ?? 0,
      pendingPayments: pending._sum.submittedAmount ?? 0,
      adjustments: adjustments._sum.amount ?? 0,
    };
  }

  /** Official balance now: current delivery values minus approved payments (PAY-4, PAY-6). */
  private async outstanding(tx: Tx, p: Pair): Promise<number> {
    const all = await this.sums(tx, p, {});
    return all.deliveredValue - all.approvedPayments;
  }

  // ------------------------------------------------------------------ dashboards (CFD, AFD)

  /** CFD-3 to CFD-5, AFD-1 to AFD-4: one contractor, or every contractor for the bakery admin. */
  summary(
    user: AuthUser,
    org: OrgContext,
    q: { contractor_id?: string; provider_id?: string; from?: string; to?: string },
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const pairs: (Pair & { name: string })[] = [];
      if (org.organizationType === 'provider' && !q.contractor_id) {
        for (const c of await this.contractorsOf(tx, org.organizationId)) {
          pairs.push({ providerId: org.organizationId, contractorId: c.id, name: c.name });
        }
      } else {
        const p = await this.pair(tx, org, q);
        const c = await tx.organization.findUnique({
          where: { id: p.contractorId },
          select: { name: true },
        });
        pairs.push({ ...p, name: c?.name ?? '' });
      }
      const rows: {
        contractor: { id: string; name: string };
        deliveredValue: number;
        approvedPayments: number;
        pendingPayments: number;
        outstanding: number;
      }[] = [];
      for (const p of pairs) {
        const inRange = await this.sums(tx, p, { from: q.from, to: q.to });
        rows.push({
          contractor: { id: p.contractorId, name: p.name },
          deliveredValue: inRange.deliveredValue,
          approvedPayments: inRange.approvedPayments,
          pendingPayments: inRange.pendingPayments,
          outstanding: await this.outstanding(tx, p),
        });
      }
      const total = (
        k: 'deliveredValue' | 'approvedPayments' | 'pendingPayments' | 'outstanding',
      ) => rows.reduce((s, r) => s + r[k], 0);
      return {
        from: q.from ?? null,
        to: q.to ?? null,
        contractors: rows,
        totals: {
          deliveredValue: total('deliveredValue'),
          approvedPayments: total('approvedPayments'),
          pendingPayments: total('pendingPayments'),
          outstanding: total('outstanding'),
        },
      };
    });
  }

  /** CFD-1, CFD-2, FIN-4, PAY-8: valued deliveries with lines, paid so far and remaining. */
  deliveries(
    user: AuthUser,
    org: OrgContext,
    q: { contractor_id?: string; provider_id?: string; from: string; to: string },
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const pairs = await this.scope(tx, org, q);
      if (!pairs.length) return { items: [], nextCursor: null };
      const rows = await tx.delivery.findMany({
        where: {
          organizationId: pairs[0]!.providerId,
          contractorOrgId: { in: pairs.map((p) => p.contractorId) },
          status: { in: [...VALUED] },
          deliveryDate: { gte: day(q.from), lte: day(q.to) },
        },
        include: { lines: { orderBy: { productName: 'asc' } } },
        orderBy: { deliveryDate: 'desc' },
      });
      return {
        items: await Promise.all(rows.map((d) => this.presentDelivery(tx, d))),
        nextCursor: null,
      };
    });
  }

  private async paidFor(tx: Tx, deliveryId: string, exceptPaymentId?: string): Promise<number> {
    const agg = await tx.paymentAllocation.aggregate({
      where: {
        deliveryId,
        payment: { status: 'approved' },
        ...(exceptPaymentId ? { NOT: { paymentId: exceptPaymentId } } : {}),
      },
      _sum: { amount: true },
    });
    return agg._sum.amount ?? 0;
  }

  private async presentDelivery(
    tx: Tx,
    d: Prisma.DeliveryGetPayload<{ include: { lines: true } }>,
  ) {
    const paid = await this.paidFor(tx, d.id);
    return {
      id: d.id,
      deliveryDate: iso(d.deliveryDate),
      status: d.status,
      totalValue: d.totalValue ?? 0,
      paidValue: paid,
      remainingValue: (d.totalValue ?? 0) - paid,
      lines: d.lines
        .filter((l) => l.deliveredQuantity > 0)
        .map((l) => ({
          productName: l.productName,
          deliveredQuantity: l.deliveredQuantity,
          unitPrice: l.unitPrice,
          lineValue: l.lineValue,
        })),
    };
  }

  /** CFD-6, AFD-5: deliveries, payments and adjustments, newest first. */
  history(
    user: AuthUser,
    org: OrgContext,
    q: { contractor_id?: string; provider_id?: string; from: string; to: string },
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const pairs = await this.scope(tx, org, q);
      if (!pairs.length) return { items: [], nextCursor: null };
      const base = {
        organizationId: pairs[0]!.providerId,
        contractorOrgId: { in: pairs.map((p) => p.contractorId) },
      };
      const names = await this.names(
        tx,
        pairs.map((p) => p.contractorId),
      );
      const [deliveries, payments, adjustments] = await Promise.all([
        tx.delivery.findMany({
          where: {
            ...base,
            status: { in: [...VALUED] },
            deliveryDate: { gte: day(q.from), lte: day(q.to) },
          },
        }),
        tx.payment.findMany({
          where: { ...base, createdAt: { gte: day(q.from), lt: day(addDays(q.to, 1)) } },
        }),
        tx.balanceAdjustment.findMany({
          where: { ...base, effectiveDate: { gte: day(q.from), lte: day(q.to) } },
        }),
      ]);
      const items = [
        ...deliveries.map((d) => ({
          kind: 'delivery' as const,
          date: iso(d.deliveryDate),
          id: d.id,
          amount: d.totalValue ?? 0,
          status: d.status,
          note: null as string | null,
        })),
        ...payments.map((x) => ({
          kind: 'payment' as const,
          date: x.paymentDate ? iso(x.paymentDate) : iso(x.createdAt),
          id: x.id,
          contractor: names.get(x.contractorOrgId)!,
          amount: x.approvedAmount ?? x.submittedAmount,
          status: x.status,
          note: x.rejectionReason ?? x.reversedReason ?? x.note,
        })),
        ...adjustments.map((a) => ({
          kind: 'adjustment' as const,
          date: iso(a.effectiveDate),
          id: a.id,
          amount: a.amount,
          status: 'applied',
          note: a.reason,
        })),
      ].sort((a, b) => b.date.localeCompare(a.date) || a.kind.localeCompare(b.kind));
      return { items, nextCursor: null };
    });
  }

  // ------------------------------------------------------------------ payments (PAY-1 to PAY-8)

  /** PAY-1: the contractor confirms a payment with proof; it stays pending until reviewed. */
  async submit(
    user: AuthUser,
    org: OrgContext,
    input: { providerId: string; amount: number; note?: string },
    file: Express.Multer.File | undefined,
  ) {
    if (org.organizationType !== 'contractor') throw Errors.forbidden();
    if (!file)
      throw Errors.validation({
        proof: ['Attach the payment proof, such as the transfer receipt.'],
      });
    if (file.size > MAX_PROOF_BYTES)
      throw Errors.validation({ proof: ['Use a file of at most 10 MB.'] });
    const ext = sniffProof(file.buffer);
    if (!ext) throw Errors.validation({ proof: ['Use a picture (JPEG, PNG, WebP) or a PDF.'] });
    const key = newKey(input.providerId, 'payment', ext);
    return this.db.run(dbContext(user, org), async (tx) => {
      const p = await this.pair(tx, org, { provider_id: input.providerId });
      await this.storage.put(key, file.buffer, CONTENT_TYPES[ext]);
      // The payment lives with the bakery's money records; the contractor reads it as its own.
      await switchOrganization(tx, p.providerId);
      const payment = await tx.payment.create({
        data: {
          organizationId: p.providerId,
          contractorOrgId: p.contractorId,
          submittedById: user.userId,
          submittedAmount: input.amount,
          note: input.note ?? null,
          proofKey: key,
          proofType: CONTENT_TYPES[ext],
        },
      });
      await this.audit.record(tx, {
        organizationId: p.providerId,
        actor: actorFor(user),
        action: 'payment.submit',
        entity: 'payment',
        entityId: payment.id,
        after: { amount: input.amount, contractorOrgId: p.contractorId },
      });
      await this.notifications.notify(tx, {
        organizationId: p.providerId,
        userIds: await this.notifications.admins(tx, p.providerId),
        type: 'payment.submitted',
        payload: { paymentId: payment.id, amount: input.amount },
      });
      return this.presentPayment(tx, payment.id);
    });
  }

  /** PAY-2, AFD-8: the review queue for the bakery, own submissions for a contractor. */
  listPayments(
    user: AuthUser,
    org: OrgContext,
    q: {
      status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'reversed';
      contractor_id?: string;
      provider_id?: string;
    },
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const where: Prisma.PaymentWhereInput =
        org.organizationType === 'contractor'
          ? {
              contractorOrgId: org.organizationId,
              ...(q.provider_id ? { organizationId: q.provider_id } : {}),
            }
          : {
              organizationId: org.organizationId,
              ...(q.contractor_id ? { contractorOrgId: q.contractor_id } : {}),
            };
      const rows = await tx.payment.findMany({
        where: { ...where, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true },
      });
      return {
        items: await Promise.all(rows.map((r) => this.presentPayment(tx, r.id))),
        nextCursor: null,
      };
    });
  }

  /** F2: a contractor may withdraw a submission before it is reviewed. */
  cancel(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id, contractorOrgId: org.organizationId },
      });
      if (!payment || org.organizationType !== 'contractor') throw Errors.notFound('Payment');
      if (payment.status !== 'pending')
        throw Errors.conflict('NOT_PENDING', 'Only a pending payment can be withdrawn.');
      await switchOrganization(tx, payment.organizationId);
      await tx.payment.update({
        where: { id },
        data: { status: 'cancelled', version: { increment: 1 } },
      });
      await this.audit.record(tx, {
        organizationId: payment.organizationId,
        actor: actorFor(user),
        action: 'payment.cancel',
        entity: 'payment',
        entityId: id,
        before: { status: 'pending' },
        after: { status: 'cancelled' },
      });
      return this.presentPayment(tx, id);
    });
  }

  /** PAY-3, PAY-7, rule 4: approve with amount and date, fully allocated to deliveries. */
  approve(user: AuthUser, org: OrgContext, id: string, input: ApproveInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const payment = await this.reviewable(tx, org, id);
      await this.checkAllocations(tx, payment, input.approvedAmount, input.allocations);
      if (
        await inClosedPeriod(
          tx,
          payment.organizationId,
          payment.contractorOrgId,
          day(input.paymentDate),
        )
      ) {
        throw Errors.conflict(
          'PERIOD_CLOSED',
          'That payment date is in a closed settlement period. Use a date in the open period.',
        );
      }
      await tx.payment.update({
        where: { id },
        data: {
          status: 'approved',
          approvedAmount: input.approvedAmount,
          paymentDate: day(input.paymentDate),
          reviewedById: user.userId,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.paymentAllocation.createMany({
        data: input.allocations.map((a) => ({
          organizationId: payment.organizationId,
          contractorOrgId: payment.contractorOrgId,
          paymentId: id,
          deliveryId: a.deliveryId,
          amount: a.amount,
          createdById: user.userId,
        })),
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'payment.approve',
        entity: 'payment',
        entityId: id,
        before: { status: 'pending', submittedAmount: payment.submittedAmount },
        after: {
          status: 'approved',
          approvedAmount: input.approvedAmount,
          paymentDate: input.paymentDate,
          allocations: input.allocations,
        },
      });
      await this.tellContractor(tx, payment, 'payment.approved', {
        paymentId: id,
        amount: input.approvedAmount,
      });
      return this.presentPayment(tx, id);
    });
  }

  /** PAY-3: rejection needs a reason; a rejected payment never changes a balance. */
  reject(user: AuthUser, org: OrgContext, id: string, reason: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const payment = await this.reviewable(tx, org, id);
      await tx.payment.update({
        where: { id },
        data: {
          status: 'rejected',
          rejectionReason: reason,
          reviewedById: user.userId,
          reviewedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'payment.reject',
        entity: 'payment',
        entityId: id,
        before: { status: 'pending' },
        after: { status: 'rejected', reason },
      });
      await this.tellContractor(tx, payment, 'payment.rejected', {
        paymentId: id,
        amount: payment.submittedAmount,
        reason,
      });
      return this.presentPayment(tx, id);
    });
  }

  /** PAY-5: move an approved payment between deliveries; refused once its period is closed. */
  reallocate(user: AuthUser, org: OrgContext, id: string, input: ReallocateInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id, organizationId: org.organizationId },
        include: { allocations: true },
      });
      if (!payment) throw Errors.notFound('Payment');
      if (payment.status !== 'approved')
        throw Errors.conflict('NOT_APPROVED', 'Only an approved payment can be allocated.');
      if (
        payment.paymentDate &&
        (await inClosedPeriod(
          tx,
          payment.organizationId,
          payment.contractorOrgId,
          payment.paymentDate,
        ))
      ) {
        throw Errors.conflict(
          'PERIOD_CLOSED',
          'This payment is in a closed settlement period and cannot change.',
        );
      }
      await this.checkAllocations(tx, payment, payment.approvedAmount!, input.allocations, id);
      await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
      await tx.paymentAllocation.createMany({
        data: input.allocations.map((a) => ({
          organizationId: payment.organizationId,
          contractorOrgId: payment.contractorOrgId,
          paymentId: id,
          deliveryId: a.deliveryId,
          amount: a.amount,
          createdById: user.userId,
        })),
      });
      await tx.payment.update({ where: { id }, data: { version: { increment: 1 } } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'payment.reallocate',
        entity: 'payment',
        entityId: id,
        before: {
          allocations: payment.allocations.map((a) => ({
            deliveryId: a.deliveryId,
            amount: a.amount,
          })),
        },
        after: { allocations: input.allocations },
      });
      return this.presentPayment(tx, id);
    });
  }

  /**
   * Rule 6: an approved payment is never edited; a mistake is undone by an audited reversal.
   * If its date is in a closed period, the closed report stays and the open period gets an
   * adjustment (rule 9).
   */
  reverse(user: AuthUser, org: OrgContext, id: string, reason: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const payment = await tx.payment.findFirst({
        where: { id, organizationId: org.organizationId },
      });
      if (!payment) throw Errors.notFound('Payment');
      if (payment.status !== 'approved')
        throw Errors.conflict('NOT_APPROVED', 'Only an approved payment can be reversed.');
      await tx.payment.update({
        where: { id },
        data: {
          status: 'reversed',
          reversedReason: reason,
          reversedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (
        payment.paymentDate &&
        (await inClosedPeriod(
          tx,
          payment.organizationId,
          payment.contractorOrgId,
          payment.paymentDate,
        ))
      ) {
        await tx.balanceAdjustment.create({
          data: {
            organizationId: payment.organizationId,
            contractorOrgId: payment.contractorOrgId,
            paymentId: id,
            effectiveDate: day(await this.today(tx, payment.organizationId)),
            amount: payment.approvedAmount ?? 0,
            reason: `Payment of ${iso(payment.paymentDate)} reversed after its settlement period was closed: ${reason}`,
            createdById: user.userId,
          },
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'payment.reverse',
        entity: 'payment',
        entityId: id,
        before: { status: 'approved', approvedAmount: payment.approvedAmount },
        after: { status: 'reversed', reason },
      });
      await this.tellContractor(tx, payment, 'payment.reversed', {
        paymentId: id,
        amount: payment.approvedAmount,
        reason,
      });
      return this.presentPayment(tx, id);
    });
  }

  private async reviewable(tx: Tx, org: OrgContext, id: string) {
    const payment = await tx.payment.findFirst({
      where: { id, organizationId: org.organizationId },
    });
    if (!payment) throw Errors.notFound('Payment');
    if (payment.status !== 'pending')
      throw Errors.conflict('NOT_PENDING', `This payment is already ${payment.status}.`);
    return payment;
  }

  /** Rules 4 and 5: allocations add up to the approved amount and never exceed what remains. */
  private async checkAllocations(
    tx: Tx,
    payment: { organizationId: string; contractorOrgId: string },
    amount: number,
    allocations: { deliveryId: string; amount: number }[],
    exceptPaymentId?: string,
  ) {
    const sum = allocations.reduce((s, a) => s + a.amount, 0);
    if (sum !== amount) {
      throw Errors.validation({
        allocations: [`Allocate exactly ${amount} won; these add up to ${sum}.`],
      });
    }
    const ids = new Set(allocations.map((a) => a.deliveryId));
    if (ids.size !== allocations.length)
      throw Errors.validation({ allocations: ['List each delivery once.'] });
    for (const a of allocations) {
      const d = await tx.delivery.findFirst({
        where: {
          id: a.deliveryId,
          organizationId: payment.organizationId,
          contractorOrgId: payment.contractorOrgId,
          status: { in: [...VALUED] },
        },
      });
      if (!d || d.totalValue === null) {
        throw Errors.validation({
          allocations: ['Allocate only to completed deliveries of this contractor.'],
        });
      }
      const remaining = d.totalValue - (await this.paidFor(tx, d.id, exceptPaymentId));
      if (a.amount > remaining) {
        throw Errors.validation({
          allocations: [
            `The delivery of ${iso(d.deliveryDate)} has ${remaining} won left to pay; ${a.amount} is too much.`,
          ],
        });
      }
    }
  }

  private async tellContractor(
    tx: Tx,
    payment: { organizationId: string; contractorOrgId: string },
    type: string,
    payload: Prisma.InputJsonObject,
  ) {
    await switchOrganization(tx, payment.contractorOrgId);
    const admins = await tx.membership.findMany({
      where: { organizationId: payment.contractorOrgId, status: 'active', role: 'admin' },
      select: { userId: true },
    });
    await switchOrganization(tx, payment.organizationId);
    await this.notifications.notify(tx, {
      organizationId: payment.organizationId,
      userIds: admins.map((a) => a.userId),
      type,
      payload,
    });
  }

  private async presentPayment(tx: Tx, id: string) {
    const p = await tx.payment.findUniqueOrThrow({
      where: { id },
      include: { allocations: { orderBy: { createdAt: 'asc' } } },
    });
    const [provider, contractor, deliveries] = await Promise.all([
      tx.organization.findUnique({
        where: { id: p.organizationId },
        select: { id: true, name: true },
      }),
      tx.organization.findUnique({
        where: { id: p.contractorOrgId },
        select: { id: true, name: true },
      }),
      tx.delivery.findMany({
        where: { id: { in: p.allocations.map((a) => a.deliveryId) } },
        select: { id: true, deliveryDate: true },
      }),
    ]);
    return {
      id: p.id,
      provider,
      contractor,
      submittedAmount: p.submittedAmount,
      note: p.note,
      proofUrl: await this.storage.signedUrl(p.proofKey),
      proofType: p.proofType,
      status: p.status,
      approvedAmount: p.approvedAmount,
      paymentDate: p.paymentDate ? iso(p.paymentDate) : null,
      rejectionReason: p.rejectionReason,
      reversedReason: p.reversedReason,
      reviewedAt: p.reviewedAt,
      allocations: p.allocations.map((a) => ({
        deliveryId: a.deliveryId,
        deliveryDate: (() => {
          const d = deliveries.find((x) => x.id === a.deliveryId);
          return d ? iso(d.deliveryDate) : null;
        })(),
        amount: a.amount,
      })),
      version: p.version,
      createdAt: p.createdAt,
    };
  }

  // ------------------------------------------------------------------ settlement (SET-1 to SET-6)

  /** SET-4, CFD-7, AFD-7: the contractor's periods, with live totals for open ones. */
  schedule(user: AuthUser, org: OrgContext, q: { contractor_id?: string; provider_id?: string }) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const pairs = await this.scope(tx, org, q);
      const names = await this.names(
        tx,
        pairs.map((p) => p.contractorId),
      );
      const items = [];
      for (const p of pairs) {
        for (const r of await this.reports(tx, p))
          items.push({ ...r, contractor: names.get(p.contractorId)! });
      }
      return { items, nextCursor: null };
    });
  }

  /**
   * SET-3, SET-5, rule 7, rule 10, F5: replaces every period that is not closed. Periods are
   * contiguous; the first starts the day after the last closed one; a period already under way
   * keeps its start but may get a new end. Audited with old and new dates (SET-6).
   */
  setSchedule(user: AuthUser, org: OrgContext, contractorId: string, input: ScheduleInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const p = await this.pair(tx, org, { contractor_id: contractorId });
      const existing = await tx.settlementPeriod.findMany({
        where: { organizationId: p.providerId, contractorOrgId: p.contractorId },
        orderBy: { startDate: 'asc' },
      });
      const closed = existing.filter((x) => x.status === 'closed');
      const open = existing.filter((x) => x.status === 'open');
      const today = await this.today(tx, p.providerId);
      const periods = [...input.periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
      for (const [i, x] of periods.entries()) {
        if (x.endDate < x.startDate)
          throw Errors.validation({ periods: [`${x.startDate}: the end is before the start.`] });
        const prev = periods[i - 1];
        if (prev && x.startDate !== addDays(prev.endDate, 1)) {
          throw Errors.validation({
            periods: [
              `Periods must follow each other: after ${prev.endDate} comes ${addDays(prev.endDate, 1)}.`,
            ],
          });
        }
      }
      const lastClosed = closed.at(-1);
      const first = periods[0];
      if (first && lastClosed && first.startDate <= iso(lastClosed.endDate)) {
        throw Errors.conflict(
          'PERIOD_CLOSED',
          `Dates up to ${iso(lastClosed.endDate)} are in closed periods and cannot change.`,
        );
      }
      if (first && lastClosed && first.startDate !== addDays(iso(lastClosed.endDate), 1)) {
        throw Errors.validation({
          periods: [
            `The first period must start on ${addDays(iso(lastClosed.endDate), 1)}, right after the last closed one.`,
          ],
        });
      }
      const running = open.find((x) => iso(x.startDate) <= today);
      if (running && (!first || first.startDate !== iso(running.startDate))) {
        throw Errors.validation({
          periods: [
            `The period that started on ${iso(running.startDate)} is under way: keep its start; you may move its end.`,
          ],
        });
      }
      await tx.settlementPeriod.deleteMany({ where: { id: { in: open.map((x) => x.id) } } });
      if (periods.length) {
        await tx.settlementPeriod.createMany({
          data: periods.map((x) => ({
            organizationId: p.providerId,
            contractorOrgId: p.contractorId,
            startDate: day(x.startDate),
            endDate: day(x.endDate),
            kind: x.kind,
            createdById: user.userId,
          })),
        });
      }
      const show = (list: { startDate: Date | string; endDate: Date | string; kind: string }[]) =>
        list.map((x) => ({
          start: typeof x.startDate === 'string' ? x.startDate : iso(x.startDate),
          end: typeof x.endDate === 'string' ? x.endDate : iso(x.endDate),
          kind: x.kind,
        }));
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'settlement.schedule',
        entity: 'contractor',
        entityId: p.contractorId,
        before: { periods: show(open) },
        after: { periods: show(periods) },
      });
      return { items: await this.reports(tx, p), nextCursor: null };
    });
  }

  /** SET-1, SET-2: every period in order; closed ones from their snapshot, open ones live. */
  private async reports(tx: Tx, p: Pair) {
    const periods = await tx.settlementPeriod.findMany({
      where: { organizationId: p.providerId, contractorOrgId: p.contractorId },
      orderBy: { startDate: 'asc' },
      include: { report: true },
    });
    const out = [];
    let carried: number | null = null;
    for (const period of periods) {
      if (period.report) {
        const r = period.report;
        carried = r.closingBalance;
        out.push({
          id: period.id,
          startDate: iso(period.startDate),
          endDate: iso(period.endDate),
          kind: period.kind,
          status: period.status,
          openingBalance: r.openingBalance,
          deliveredValue: r.deliveredValue,
          approvedPayments: r.approvedPayments,
          adjustments: r.adjustments,
          closingBalance: r.closingBalance,
          closedAt: r.closedAt,
        });
        continue;
      }
      const live = await this.livePeriod(
        tx,
        p,
        iso(period.startDate),
        iso(period.endDate),
        carried,
      );
      carried = live.closingBalance;
      out.push({
        id: period.id,
        startDate: iso(period.startDate),
        endDate: iso(period.endDate),
        kind: period.kind,
        status: period.status,
        ...live,
        closedAt: null,
      });
    }
    return out;
  }

  private async livePeriod(tx: Tx, p: Pair, start: string, end: string, opening: number | null) {
    let openingBalance = opening;
    if (openingBalance === null) {
      const before = await this.sums(tx, p, { before: start });
      openingBalance = before.deliveredValue - before.approvedPayments;
    }
    const s = await this.sums(tx, p, { from: start, to: end });
    return {
      openingBalance,
      deliveredValue: s.deliveredValue,
      approvedPayments: s.approvedPayments,
      adjustments: s.adjustments,
      closingBalance: openingBalance + s.deliveredValue + s.adjustments - s.approvedPayments,
    };
  }

  /** Rule 8, SET-2: closes an ended period in order and stores an unchangeable snapshot. */
  close(user: AuthUser, org: OrgContext, periodId: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const period = await tx.settlementPeriod.findFirst({
        where: { id: periodId, organizationId: org.organizationId },
      });
      if (!period) throw Errors.notFound('Settlement period');
      if (period.status === 'closed')
        throw Errors.conflict('PERIOD_CLOSED', 'This period is already closed.');
      const p = { providerId: period.organizationId, contractorId: period.contractorOrgId };
      const today = await this.today(tx, p.providerId);
      if (iso(period.endDate) >= today) {
        throw Errors.conflict(
          'PERIOD_NOT_ENDED',
          `This period ends on ${iso(period.endDate)}; close it after that day.`,
        );
      }
      const earlierOpen = await tx.settlementPeriod.findFirst({
        where: {
          ...{ organizationId: p.providerId, contractorOrgId: p.contractorId },
          status: 'open',
          startDate: { lt: period.startDate },
        },
      });
      if (earlierOpen)
        throw Errors.conflict(
          'EARLIER_PERIOD_OPEN',
          `Close the period starting ${iso(earlierOpen.startDate)} first.`,
        );
      const all = await this.reports(tx, p);
      const live = all.find((x) => x.id === periodId)!;
      const base = { organizationId: p.providerId, contractorOrgId: p.contractorId };
      const range = { gte: period.startDate, lte: period.endDate };
      const [deliveries, payments, adjustments] = await Promise.all([
        tx.delivery.findMany({
          where: { ...base, status: { in: [...VALUED] }, deliveryDate: range },
          orderBy: { deliveryDate: 'asc' },
        }),
        tx.payment.findMany({
          where: { ...base, status: 'approved', paymentDate: range },
          include: { allocations: true },
          orderBy: { paymentDate: 'asc' },
        }),
        tx.balanceAdjustment.findMany({
          where: { ...base, effectiveDate: range },
          orderBy: { effectiveDate: 'asc' },
        }),
      ]);
      const snapshot = {
        deliveries: deliveries.map((d) => ({
          id: d.id,
          date: iso(d.deliveryDate),
          value: d.totalValue ?? 0,
        })),
        payments: payments.map((x) => ({
          id: x.id,
          date: x.paymentDate ? iso(x.paymentDate) : null,
          amount: x.approvedAmount ?? 0,
          allocations: x.allocations.map((a) => ({ deliveryId: a.deliveryId, amount: a.amount })),
        })),
        adjustments: adjustments.map((a) => ({
          id: a.id,
          date: iso(a.effectiveDate),
          amount: a.amount,
          reason: a.reason,
        })),
      };
      await tx.settlementReport.create({
        data: {
          ...base,
          periodId,
          openingBalance: live.openingBalance,
          deliveredValue: live.deliveredValue,
          approvedPayments: live.approvedPayments,
          adjustments: live.adjustments,
          closingBalance: live.closingBalance,
          snapshot,
          closedById: user.userId,
        },
      });
      await tx.settlementPeriod.update({ where: { id: periodId }, data: { status: 'closed' } });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'settlement.close',
        entity: 'settlement_period',
        entityId: periodId,
        after: { ...live, startDate: iso(period.startDate), endDate: iso(period.endDate) },
      });
      await this.tellContractor(tx, period, 'settlement.closed', {
        periodId,
        startDate: iso(period.startDate),
        endDate: iso(period.endDate),
        closingBalance: live.closingBalance,
      });
      return this.reportDetail(tx, periodId);
    });
  }

  /** One period with its line items: the stored snapshot once closed. */
  report(user: AuthUser, org: OrgContext, periodId: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const period = await tx.settlementPeriod.findFirst({
        where: {
          id: periodId,
          OR: [{ organizationId: org.organizationId }, { contractorOrgId: org.organizationId }],
        },
      });
      if (!period) throw Errors.notFound('Settlement period');
      return this.reportDetail(tx, periodId);
    });
  }

  private async reportDetail(tx: Tx, periodId: string) {
    const period = await tx.settlementPeriod.findUniqueOrThrow({
      where: { id: periodId },
      include: { report: true },
    });
    const p = { providerId: period.organizationId, contractorId: period.contractorOrgId };
    const summary = (await this.reports(tx, p)).find((x) => x.id === periodId)!;
    if (period.report) return { ...summary, items: period.report.snapshot };
    const base = { organizationId: p.providerId, contractorOrgId: p.contractorId };
    const range = { gte: period.startDate, lte: period.endDate };
    const [deliveries, payments, adjustments] = await Promise.all([
      tx.delivery.findMany({
        where: { ...base, status: { in: [...VALUED] }, deliveryDate: range },
        orderBy: { deliveryDate: 'asc' },
      }),
      tx.payment.findMany({
        where: { ...base, status: 'approved', paymentDate: range },
        orderBy: { paymentDate: 'asc' },
      }),
      tx.balanceAdjustment.findMany({
        where: { ...base, effectiveDate: range },
        orderBy: { effectiveDate: 'asc' },
      }),
    ]);
    return {
      ...summary,
      items: {
        deliveries: deliveries.map((d) => ({
          id: d.id,
          date: iso(d.deliveryDate),
          value: d.totalValue ?? 0,
        })),
        payments: payments.map((x) => ({
          id: x.id,
          date: x.paymentDate ? iso(x.paymentDate) : null,
          amount: x.approvedAmount ?? 0,
        })),
        adjustments: adjustments.map((a) => ({
          id: a.id,
          date: iso(a.effectiveDate),
          amount: a.amount,
          reason: a.reason,
        })),
      },
    };
  }
}
