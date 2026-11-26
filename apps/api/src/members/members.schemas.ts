import { z } from 'zod';
import { email } from '../auth/auth.schemas';
import { paginationSchema } from '../common/pagination';

export const listMembersSchema = paginationSchema.extend({
  status: z.enum(['active', 'removed']).default('active'),
  /**
   * Decided 2026-11-26: screens show the whole team at once (pickers, People, removed members),
   * so members come 100 at a time unless asked otherwise; 20 hid people past the 20th.
   */
  limit: z.coerce.number().int().min(1).max(100).default(100),
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
    /** Decided 2026-11-29: the name shown inside this organization; empty or null clears it. */
    displayName: z.string().trim().max(100).nullable().optional(),
    /** Decided 2026-11-29: the person's title here, e.g. "Head baker"; empty or null clears it. */
    title: z.string().trim().max(60).nullable().optional(),
  })
  .refine(
    (v) => Object.values(v).some((x) => x !== undefined),
    'Send role, status, worksShifts, displayName or title.',
  );

/**
 * Decided 2026-11-28: take a person out of the weekly shift plan, teams, open and repeating tasks,
 * ingredient ordering and the products they log, or hand all of that to another employee.
 * Past punches, output and finished tasks never change.
 */
export const handOverSchema = z.strictObject({
  toUserId: z.uuid().nullable(),
});
export type HandOverInput = z.infer<typeof handOverSchema>;

export type ListMembersInput = z.infer<typeof listMembersSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
