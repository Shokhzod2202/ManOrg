import { z } from 'zod';

const name = z.string().trim().min(1, 'Enter a name.').max(120, 'Use at most 120 characters.');
/** PRD-1: minutes an employee needs to prepare 10 units. */
const minutesPer10 = z.number().int('Use whole minutes.').min(1).max(10_000);
const imageKey = z.string().min(1).max(200);
const ingredients = z
  .array(
    z.strictObject({
      ingredientId: z.uuid(),
      /** Assumption (spec section 7): amounts are optional. */
      quantityPer10: z.number().positive().max(1_000_000).optional(),
    }),
  )
  .min(1, 'Add at least one ingredient.')
  .max(100)
  .refine(
    (list) => new Set(list.map((i) => i.ingredientId)).size === list.length,
    'List each ingredient once.',
  );

/** PRD-1: name, picture, ingredients and minutes per 10 are all required. */
export const createProductSchema = z.strictObject({
  name,
  imageKey,
  minutesPer10,
  ingredients,
  available: z.boolean().default(true),
});

/** PRD-2: every field can change, and availability. */
export const updateProductSchema = z
  .strictObject({
    name: name.optional(),
    imageKey: imageKey.optional(),
    minutesPer10: minutesPer10.optional(),
    ingredients: ingredients.optional(),
    available: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.');

/** PRD-3: the products an employee makes; replaces the whole list. */
export const setEmployeeProductsSchema = z.strictObject({
  productIds: z.array(z.uuid()).max(500),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type SetEmployeeProductsInput = z.infer<typeof setEmployeeProductsSchema>;
