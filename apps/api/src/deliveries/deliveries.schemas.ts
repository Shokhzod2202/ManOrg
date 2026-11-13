import { z } from 'zod';
import { hhmm, isoDate } from '../common/time';

/** DTM-1: start and end, end after start. */
export const approxTimeSchema = z
  .strictObject({ start: hhmm, end: hhmm })
  .refine((v) => v.end > v.start, { message: 'End must be after start.', path: ['end'] });

const deliveredLines = z
  .array(
    z.strictObject({
      productId: z.uuid(),
      deliveredQuantity: z.number().int().min(0).max(100_000),
    }),
  )
  .max(200)
  .refine((l) => new Set(l.map((x) => x.productId)).size === l.length, 'List each product once.');

/** DEL-1, DEL-3, DEL-4: delivered numbers; ordered products left out keep their current number. */
export const saveDeliverySchema = z.strictObject({ lines: deliveredLines });

/** DEL-6: what the contractor says was really delivered, and why. */
export const deliveryChangeSchema = z.strictObject({
  lines: deliveredLines.min(1),
  reason: z.string().trim().min(1, 'Say what is wrong.').max(500),
});

export const decisionSchema = z.strictObject({ decision: z.enum(['approve', 'reject']) });
export const listDeliveriesSchema = z
  .object({ from: isoDate, to: isoDate, contractor_id: z.uuid().optional() })
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to.', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62, {
    message: 'Ask for at most 62 days at a time.',
    path: ['to'],
  });

export type ApproxTimeInput = z.infer<typeof approxTimeSchema>;
export type SaveDeliveryInput = z.infer<typeof saveDeliverySchema>;
export type DeliveryChangeInput = z.infer<typeof deliveryChangeSchema>;
export type ListDeliveriesInput = z.infer<typeof listDeliveriesSchema>;
