import { type PackUnit } from '../generated/prisma/client';

/**
 * Decided 2026-12-01: ingredient amounts per batch, in a unit of the same kind as the
 * ingredient's pack unit, and what a batch costs at today's ingredient prices.
 */
const UNITS: Record<PackUnit, { kind: 'mass' | 'volume' | 'count'; factor: number }> = {
  g: { kind: 'mass', factor: 1 },
  kg: { kind: 'mass', factor: 1000 },
  mL: { kind: 'volume', factor: 1 },
  L: { kind: 'volume', factor: 1000 },
  pc: { kind: 'count', factor: 1 },
};

/** The units an amount of an ingredient sold in `packUnit` may be given in. */
export function unitsFor(packUnit: PackUnit): PackUnit[] {
  return (Object.keys(UNITS) as PackUnit[]).filter((u) => UNITS[u].kind === UNITS[packUnit].kind);
}

export function sameKind(a: PackUnit, b: PackUnit): boolean {
  return UNITS[a].kind === UNITS[b].kind;
}

/**
 * Cost of `quantity` `unit` of an ingredient whose pack holds `packQuantity` `packUnit` and costs
 * `packPrice` won, unrounded. Null when something is missing or the units do not match.
 */
export function lineCost(
  quantity: number | null,
  unit: PackUnit | null,
  packQuantity: number,
  packUnit: PackUnit,
  packPrice: number | null,
): number | null {
  if (quantity === null || unit === null || packPrice === null || packQuantity <= 0) return null;
  if (!sameKind(unit, packUnit)) return null;
  const inPackUnits = (quantity * UNITS[unit].factor) / UNITS[packUnit].factor;
  return (inPackUnits / packQuantity) * packPrice;
}

/**
 * A batch's cost is the sum of its ingredient lines; `missing` counts lines without an amount or
 * a price (they are left out, so the cost is then a lower bound). Per piece needs the yield.
 */
export function batchCost(lines: (number | null)[], batchYield: number | null) {
  const known = lines.filter((x): x is number => x !== null);
  const perBatch = known.length ? Math.round(known.reduce((n, x) => n + x, 0)) : null;
  return {
    perBatch,
    perPiece: perBatch !== null && batchYield ? Math.round(perBatch / batchYield) : null,
    missing: lines.length - known.length,
  };
}
