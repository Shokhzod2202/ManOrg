/**
 * Output arithmetic (OUT-2, OUT-7, TEAM-4, open question 14 second list):
 * - expected preparation minutes = quantity / 10 x the product's minutes per 10;
 * - a team line counts once in totals; each member is credited an equal share of its quantity
 *   and of its expected time.
 */
export interface LineLike {
  productId: string;
  quantity: number;
  minutesPer10: number;
  teamId: string | null;
  teamMemberIds: string[];
  employeeId: string;
}

export function expectedMinutes(quantity: number, minutesPer10: number): number {
  return (quantity / 10) * minutesPer10;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What one employee is credited with on one day. */
export function creditFor(employeeId: string, lines: LineLike[]) {
  let quantity = 0;
  let minutes = 0;
  for (const l of lines) {
    if (l.teamId === null) {
      if (l.employeeId !== employeeId) continue;
      quantity += l.quantity;
      minutes += expectedMinutes(l.quantity, l.minutesPer10);
    } else if (l.teamMemberIds.includes(employeeId)) {
      const share = 1 / Math.max(l.teamMemberIds.length, 1);
      quantity += l.quantity * share;
      minutes += expectedMinutes(l.quantity, l.minutesPer10) * share;
    }
  }
  return { creditedQuantity: round2(quantity), expectedMinutes: round2(minutes) };
}

/** Totals per product for a set of lines; each line, team or personal, counts once. */
export function totalsByProduct(lines: LineLike[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.quantity);
  return totals;
}
