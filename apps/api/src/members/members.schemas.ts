import { z } from 'zod';
import { email } from '../auth/auth.schemas';
import { paginationSchema } from '../common/pagination';

export const listMembersSchema = paginationSchema.extend({
  status: z.enum(['active', 'removed']).default('active'),
});

/** ACC-7: add an existing account to the organization, typically as another admin. */
export const createMemberSchema = z.strictObject({
  email,
  role: z.enum(['admin', 'employee']),
});

export const updateMemberSchema = z
  .strictObject({
    role: z.enum(['admin', 'employee']).optional(),
    status: z.literal('removed').optional(),
    /** Decided 2026-11-26: an admin who also works shifts (punch card, shift lists, hours). */
    worksShifts: z.boolean().optional(),
  })
  .refine(
    (v) => v.role !== undefined || v.status !== undefined || v.worksShifts !== undefined,
    'Send role, status or worksShifts.',
  );

export type ListMembersInput = z.infer<typeof listMembersSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
