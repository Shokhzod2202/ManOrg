import { z } from 'zod';
import { isoDate } from '../common/time';

const won = z.number().int('Use whole won.').min(1, 'Must be more than 0.').max(10_000_000_000);
const allocations = z
  .array(z.strictObject({ deliveryId: z.uuid(), amount: won }))
  .min(1, 'Allocate the payment to at least one delivery.')
  .max(200);

/** PAY-1: multipart fields beside the proof file. */
export const submitPaymentSchema = z.strictObject({
  providerId: z.uuid(),
  amount: z.coerce.number().pipe(won),
  note: z.string().trim().max(500).optional(),
});

/** PAY-3, PAY-7: approved amount, payment date and the split across deliveries (rule 4). */
export const approvePaymentSchema = z.strictObject({
  approvedAmount: won,
  paymentDate: isoDate,
  allocations,
});

export const rejectPaymentSchema = z.strictObject({
  reason: z.string().trim().min(1, 'Give a reason.').max(500),
});

export const reallocateSchema = z.strictObject({ allocations });

export const reverseSchema = z.strictObject({
  reason: z.string().trim().min(1, 'Give a reason.').max(500),
});

/** SET-3: the whole list of periods from the first one that is not closed. */
export const scheduleSchema = z.strictObject({
  periods: z
    .array(
      z.strictObject({
        startDate: isoDate,
        endDate: isoDate,
        kind: z.enum(['mid_month', 'month_end', 'custom']),
      }),
    )
    .max(120),
});

const range = { from: isoDate, to: isoDate };
export const pairQuery = z.object({
  contractor_id: z.uuid().optional(),
  provider_id: z.uuid().optional(),
});
export const summaryQuery = pairQuery.extend({ from: isoDate.optional(), to: isoDate.optional() });
export const rangeQuery = pairQuery
  .extend(range)
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to.', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 400, {
    message: 'Ask for at most 400 days at a time.',
    path: ['to'],
  });
export const paymentsQuery = pairQuery.extend({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'reversed']).optional(),
});

export type ApproveInput = z.infer<typeof approvePaymentSchema>;
export type ReallocateInput = z.infer<typeof reallocateSchema>;
export type ScheduleInput = z.infer<typeof scheduleSchema>;
