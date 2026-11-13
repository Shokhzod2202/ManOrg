import { z } from 'zod';
import { isoDate } from '../common/time';

/** TSK-1: title, assignee and due date. */
export const createTaskSchema = z.strictObject({
  title: z.string().trim().min(1, 'Enter a title.').max(200),
  description: z.string().trim().max(2000).optional(),
  assigneeId: z.uuid(),
  dueDate: isoDate,
});

export const updateTaskSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    assigneeId: z.uuid().optional(),
    dueDate: isoDate.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.');

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
