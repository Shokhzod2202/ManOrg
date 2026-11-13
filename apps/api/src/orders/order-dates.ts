import { addDays, localDate, localTime } from '../common/time';

/** Before this provider-local time the app asks whether a new order is for today. */
export const ASK_TODAY_BEFORE = '10:00';

/**
 * Default delivery date for a new order (decided 2026-11-13): before 10:00 provider time the app
 * suggests today and asks to confirm; from 10:00 it suggests the next day. Always editable.
 */
export function defaultDeliveryDate(
  timeZone: string,
  now = new Date(),
): { date: string; askIfToday: boolean } {
  const today = localDate(timeZone, now);
  return localTime(timeZone, now) < ASK_TODAY_BEFORE
    ? { date: today, askIfToday: true }
    : { date: addDays(today, 1), askIfToday: false };
}

export type ChangeKind = 'add' | 'increase' | 'decrease' | 'remove';

/** One item per product whose quantity differs between the order and the requested lines. */
export function diffLines(
  current: { productId: string; quantity: number }[],
  wanted: { productId: string; quantity: number }[],
): { productId: string; from: number; to: number; kind: ChangeKind }[] {
  const before = new Map(current.map((l) => [l.productId, l.quantity]));
  const after = new Map(wanted.map((l) => [l.productId, l.quantity]));
  const out: { productId: string; from: number; to: number; kind: ChangeKind }[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(id) ?? 0;
    const to = after.get(id) ?? 0;
    if (from === to) continue;
    const kind: ChangeKind =
      from === 0 ? 'add' : to === 0 ? 'remove' : to > from ? 'increase' : 'decrease';
    out.push({ productId: id, from, to, kind });
  }
  return out;
}
