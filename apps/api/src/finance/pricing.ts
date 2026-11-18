import { Errors } from '../common/errors';
import { type Tx } from '../database/prisma-client';

/** F-001 FIN-1: the price in force at a moment, or null when the product has none. */
export async function unitPriceAt(tx: Tx, productId: string, at: Date): Promise<number | null> {
  const row = await tx.productPrice.findFirst({
    where: { productId, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    select: { unitPrice: true },
  });
  return row?.unitPrice ?? null;
}

/**
 * F-001 FIN-2, FIN-3, FIN-5: copies the unit price onto each line (keeping prices already copied
 * when `keep` is set), sets line values from the delivered quantity, and the delivery total.
 * A delivered product with no price stops it (FIN-1).
 */
export async function priceDelivery(
  tx: Tx,
  deliveryId: string,
  at: Date,
  keep: boolean,
): Promise<number> {
  const lines = await tx.deliveryLine.findMany({ where: { deliveryId } });
  const missing: string[] = [];
  const priced: { id: string; unitPrice: number | null; lineValue: number | null }[] = [];
  for (const l of lines) {
    const price =
      keep && l.unitPrice !== null ? l.unitPrice : await unitPriceAt(tx, l.productId, at);
    if (price === null) {
      if (l.deliveredQuantity > 0) missing.push(l.productName);
      priced.push({ id: l.id, unitPrice: null, lineValue: l.deliveredQuantity > 0 ? null : 0 });
    } else {
      priced.push({ id: l.id, unitPrice: price, lineValue: price * l.deliveredQuantity });
    }
  }
  if (missing.length) {
    throw Errors.unprocessable(
      'PRICE_MISSING',
      `Set a price for ${missing.join(', ')} in Products before completing this delivery.`,
    );
  }
  for (const p of priced) {
    await tx.deliveryLine.update({
      where: { id: p.id },
      data: { unitPrice: p.unitPrice, lineValue: p.lineValue },
    });
  }
  const total = priced.reduce((sum, p) => sum + (p.lineValue ?? 0), 0);
  await tx.delivery.update({ where: { id: deliveryId }, data: { totalValue: total } });
  return total;
}

/** F-001 SET-5: whether a contractor's day lies in a settlement period that is already closed. */
export async function inClosedPeriod(
  tx: Tx,
  organizationId: string,
  contractorOrgId: string,
  date: Date,
): Promise<boolean> {
  const hit = await tx.settlementPeriod.findFirst({
    where: {
      organizationId,
      contractorOrgId,
      status: 'closed',
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { id: true },
  });
  return hit !== null;
}
