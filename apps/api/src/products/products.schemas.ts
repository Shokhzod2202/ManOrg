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
  .max(100)
  .refine(
    (list) => new Set(list.map((i) => i.ingredientId)).size === list.length,
    'List each ingredient once.',
  );

/**
 * PRD-1: name and minutes per 10 are required. Decided 2026-11-24: the picture and ingredients can
 * be added later by editing (a placeholder picture is used until then), and the price can be set
 * here (F-001 FIN-1; needs prices.manage).
 */
export const createProductSchema = z.strictObject({
  name,
  imageKey: imageKey.optional(),
  minutesPer10,
  ingredients: ingredients.default([]),
  unitPrice: z.number().int('Use whole won.').min(0).max(100_000_000).optional(),
  /** Decided 2026-11-30: the product type (null for none). */
  typeId: z.uuid().nullable().optional(),
  available: z.boolean().default(true),
});

/** PRD-2: every field can change, and availability. */
export const updateProductSchema = z
  .strictObject({
    name: name.optional(),
    imageKey: imageKey.optional(),
    minutesPer10: minutesPer10.optional(),
    ingredients: ingredients.optional(),
    typeId: z.uuid().nullable().optional(),
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

/** F-001 FIN-1: whole won per unit. */
export const setProductPriceSchema = z.strictObject({
  unitPrice: z.number().int('Use whole won.').min(0).max(100_000_000),
});
export type SetProductPriceInput = z.infer<typeof setProductPriceSchema>;

/** Decided 2026-11-30: a product type such as Meal or Bakery, created by an admin. */
export const productTypeSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name.').max(60, 'Use at most 60 characters.'),
});
export type ProductTypeInput = z.infer<typeof productTypeSchema>;

/** Decided 2026-11-30: the admin's custom order, as the whole list of product ids, first first. */
export const productOrderSchema = z.strictObject({
  productIds: z.array(z.uuid()).min(1).max(2000),
});
export type ProductOrderInput = z.infer<typeof productOrderSchema>;
