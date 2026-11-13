import { z } from 'zod';
import { hhmm } from '../common/time';

const name = z.string().trim().min(1, 'Enter a name.').max(120, 'Use at most 120 characters.');
const source = z.string().trim().min(1, 'Enter where it is bought.').max(200);
const packUnit = z.enum(['g', 'kg', 'pc', 'L', 'mL']);
const packQuantity = z.number().positive('Must be more than 0.').max(1_000_000).multipleOf(0.001);
/** Whole won (decided 2026-11-12). */
export const won = z.number().int('Use whole won.').min(0).max(1_000_000_000);

/** Open question 14: weekly day (0 = Sunday) and time; null when there is no schedule. */
const orderSchedule = z.object({ weekday: z.number().int().min(0).max(6), time: hhmm }).nullable();

export const createIngredientSchema = z.strictObject({
  name,
  source,
  orderSchedule: orderSchedule.default(null),
  packQuantity,
  packUnit,
  packPrice: won.optional(),
});

/** ING-2: edit what one pack contains, and the other fields. The price has its own endpoint. */
export const updateIngredientSchema = z
  .strictObject({
    name: name.optional(),
    source: source.optional(),
    orderSchedule: orderSchedule.optional(),
    packQuantity: packQuantity.optional(),
    packUnit: packUnit.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.');

export const setPriceSchema = z.strictObject({ packPrice: won });

export const setAssigneesSchema = z.strictObject({
  employeeIds: z.array(z.uuid()).max(200),
});

export type CreateIngredientInput = z.infer<typeof createIngredientSchema>;
export type UpdateIngredientInput = z.infer<typeof updateIngredientSchema>;
export type SetPriceInput = z.infer<typeof setPriceSchema>;
export type SetAssigneesInput = z.infer<typeof setAssigneesSchema>;
