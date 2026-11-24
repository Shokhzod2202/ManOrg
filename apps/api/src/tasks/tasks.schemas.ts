import { z } from 'zod';
import { isoDate } from '../common/time';

/**
 * TSK-1: title, who it is for, and due date. Decided 2026-11-24: a task can be for one person,
 * several people (assigneeIds), or every employee including people who join later (forAll).
 * `assigneeId` is kept for one person.
 */
const audience = {
  assigneeId: z.uuid().optional(),
  assigneeIds: z.array(z.uuid()).min(1).max(200).optional(),
  forAll: z.boolean().optional(),
};
type Audience = { assigneeId?: string; assigneeIds?: string[]; forAll?: boolean };
const oneAudience = (v: Audience, ctx: z.RefinementCtx, required: boolean) => {
  const given = [v.assigneeId !== undefined, v.assigneeIds !== undefined, v.forAll === true];
  const n = given.filter(Boolean).length;
  if (n > 1)
    ctx.addIssue({
      code: 'custom',
      path: ['assigneeIds'],
      message: 'Choose people or "For all", not both.',
    });
  if (required && n === 0)
    ctx.addIssue({ code: 'custom', path: ['assigneeIds'], message: 'Choose who the task is for.' });
};

export const createTaskSchema = z
  .strictObject({
    title: z.string().trim().min(1, 'Enter a title.').max(200),
    description: z.string().trim().max(2000).optional(),
    ...audience,
    dueDate: isoDate,
  })
  .superRefine((v, ctx) => oneAudience(v, ctx, true));

export const updateTaskSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    ...audience,
    dueDate: isoDate.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.')
  .superRefine((v, ctx) => oneAudience(v, ctx, false));

export const listTasksSchema = z.object({
  status: z.enum(['open', 'done']).optional(),
  type: z.enum(['general', 'ingredient_order']).optional(),
});

/** ING-5: the ingredient, number of packs and an optional note. */
export const createIngredientOrderSchema = z.strictObject({
  ingredientId: z.uuid(),
  quantity: z.number().int().min(1, 'Order at least one pack.').max(10_000),
  note: z.string().trim().max(500).optional(),
});

export const listIngredientOrdersSchema = z.object({
  status: z.enum(['requested', 'fulfilled', 'checked']).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateIngredientOrderInput = z.infer<typeof createIngredientOrderSchema>;
