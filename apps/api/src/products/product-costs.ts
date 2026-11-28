import { type Tx } from '../database/prisma-client';
import { batchCost, lineCost } from './batch-cost';

/**
 * Decided 2026-11-26: each product's current price and its ingredient cost per piece (from the
 * batch at today's ingredient prices, decided 2026-12-01). Null when not known yet.
 */
export async function productEconomics(tx: Tx, organizationId: string, productIds: string[]) {
  const rows = await tx.product.findMany({
    where: { organizationId, id: { in: productIds } },
    select: {
      id: true,
      name: true,
      minutesPer10: true,
      batchYield: true,
      prices: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 1 },
      ingredients: {
        select: {
          batchQuantity: true,
          batchUnit: true,
          ingredient: {
            select: {
              packQuantity: true,
              packUnit: true,
              wasteQuantity: true,
              prices: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 1 },
            },
          },
        },
      },
    },
  });
  return new Map(
    rows.map((p) => {
      const cost = batchCost(
        p.ingredients.map((i) =>
          lineCost(
            i.batchQuantity === null ? null : Number(i.batchQuantity.toString()),
            i.batchUnit,
            // Decided 2026-11-28: the usable part of the pack.
            Number(i.ingredient.packQuantity.toString()) -
              Number(i.ingredient.wasteQuantity.toString()),
            i.ingredient.packUnit,
            i.ingredient.prices[0]?.packPrice ?? null,
          ),
        ),
        p.batchYield,
      );
      return [
        p.id,
        {
          name: p.name,
          unitPrice: p.prices[0]?.unitPrice ?? null,
          // Unrounded, so many pieces add up exactly.
          costPerPiece:
            cost.perBatch !== null && p.batchYield ? cost.perBatch / p.batchYield : null,
          costComplete: cost.missing === 0,
        },
      ] as const;
    }),
  );
}
