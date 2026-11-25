import { z } from 'zod';
import { email, password, personName } from '../auth/auth.schemas';

/** ACC-8: name and credentials can change; role cannot (unknown keys are rejected). */
export const updateMeSchema = z
  .strictObject({
    name: personName.optional(),
    email: email.optional(),
    password: password.optional(),
    currentPassword: z.string().min(1).max(200).optional(),
    locale: z.enum(['en', 'ko', 'uz']).optional(),
    /** Choices that stay until the person changes them (decided 2026-11-13). */
    preferences: z
      .strictObject({
        ordersView: z.enum(['list', 'matrix', 'products']).optional(),
        /** Spec section 9: the employee can turn the arrival prompt off. */
        arrivalPrompt: z.boolean().optional(),
        /** Decided 2026-11-30: how product lists are sorted. */
        productSort: z.enum(['custom', 'name', 'type']).optional(),
      })
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.');
// Changing the email or password needs the current password when the account has one; an account
// made through Telegram adds its first email and password without one (checked in MeService).

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
