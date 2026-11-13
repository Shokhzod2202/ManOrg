import { z } from 'zod';
import { isoDate } from '../common/time';

const lines = z
  .array(
    z.strictObject({
      productId: z.uuid(),
      quantity: z.number().int().min(1, 'Order at least 1.').max(100_000),
    }),
  )
  .max(200)
  .refine((l) => new Set(l.map((x) => x.productId)).size === l.length, 'List each product once.');

/** ORD-2 with the 2026-11-13 date rules: any date from today on, chosen from a calendar. */
export const placeOrderSchema = z.strictObject({
  providerId: z.uuid(),
  deliveryDate: isoDate,
  lines: lines.min(1, 'Add at least one product.'),
});

/** A contractor's requested change: the whole new list; an empty list asks to cancel the order. */
export const changeRequestSchema = z.strictObject({
  lines,
  note: z.string().trim().max(500).optional(),
});

/** The provider admin's direct correction (orders.edit). */
export const setLinesSchema = z.strictObject({ lines });

export const providerQuerySchema = z.object({ provider_id: z.uuid() });
export const listOrdersSchema = z
  .object({ from: isoDate, to: isoDate, contractor_id: z.uuid().optional() })
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to.', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62, {
    message: 'Ask for at most 62 days at a time.',
    path: ['to'],
  });
export const totalsQuerySchema = z.object({ delivery_date: isoDate });
export const changeListSchema = z.object({ status: z.enum(['open', 'closed']).default('open') });

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>;
export type SetLinesInput = z.infer<typeof setLinesSchema>;
export type ListOrdersInput = z.infer<typeof listOrdersSchema>;
