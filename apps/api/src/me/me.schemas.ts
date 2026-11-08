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
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.');

export type UpdateMeInput = z.infer<typeof updateMeSchema>;
