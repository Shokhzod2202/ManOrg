import { z } from 'zod';
import { isoDate } from '../common/time';

const teamName = z.string().trim().min(1, 'Enter a name.').max(80);
const memberIds = z.array(z.uuid()).max(50);

/** TEAM-1 / OUT-5: a saved team; its creator is always a member. */
export const createTeamSchema = z.strictObject({ name: teamName, memberIds });
export const updateTeamSchema = z
  .strictObject({ name: teamName.optional(), memberIds: memberIds.optional() })
  .refine((v) => v.name !== undefined || v.memberIds !== undefined, 'Send name or memberIds.');

/** OUT-1, OUT-6, TEAM-2: one day's personal and team lines plus cleaning hours. */
export const putOutputSchema = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        productId: z.uuid(),
        quantity: z.number().int('Use a whole number.').min(0).max(100_000),
        teamId: z.uuid().nullable().default(null),
      }),
    )
    .max(200)
    .refine(
      (lines) =>
        new Set(lines.map((l) => `${l.teamId ?? 'self'}:${l.productId}`)).size === lines.length,
      'List each product once for yourself and once per team.',
    ),
  cleaningHours: z.number().min(0).max(24).multipleOf(0.25, 'Use quarter hours.').default(0),
});

export const outputQuerySchema = z.object({ employee_id: z.uuid().optional() });
export const outputRangeSchema = z
  .object({ from: isoDate, to: isoDate, employee_id: z.uuid().optional() })
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to.', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62, {
    message: 'Ask for at most 62 days at a time.',
    path: ['to'],
  });
export const dayQuerySchema = z.object({ date: isoDate });

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type PutOutputInput = z.infer<typeof putOutputSchema>;
export type OutputRangeInput = z.infer<typeof outputRangeSchema>;
