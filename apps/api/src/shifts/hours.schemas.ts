import { z } from 'zod';
import { isoDate } from '../common/time';

/** Decided 2026-11-30: one calendar month of worked hours and advances. */
export const hoursQuerySchema = z.strictObject({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM.')
    .optional(),
  employee_id: z.uuid().optional(),
});
export type HoursQuery = z.infer<typeof hoursQuerySchema>;

/** An advance on salary ("avans") paid to an employee, in whole won. */
export const createAdvanceSchema = z.strictObject({
  employeeId: z.uuid(),
  amount: z.number().int().min(1).max(100_000_000),
  /** The day the money was transferred; defaults to today. Never in the future. */
  paidOn: isoDate.optional(),
  note: z.string().trim().max(200).optional(),
});
export type CreateAdvanceInput = z.infer<typeof createAdvanceSchema>;

export const cancelAdvanceSchema = z.strictObject({
  reason: z.string().trim().max(200).optional(),
});
export type CancelAdvanceInput = z.infer<typeof cancelAdvanceSchema>;
