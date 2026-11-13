import { z } from 'zod';
import { hhmm, isoDate } from '../common/time';

/** SHF-1: an employee's weekly plan; a day whose end is not after its start ends the next day. */
export const setShiftsSchema = z.strictObject({
  employeeId: z.uuid(),
  days: z
    .array(
      z
        .strictObject({ weekday: z.number().int().min(0).max(6), startTime: hhmm, endTime: hhmm })
        .refine((d) => d.startTime !== d.endTime, {
          message: 'Start and end must differ.',
          path: ['endTime'],
        }),
    )
    .max(7)
    .refine(
      (days) => new Set(days.map((d) => d.weekday)).size === days.length,
      'List each weekday once.',
    ),
});

export const punchSchema = z.strictObject({ action: z.enum(['start', 'pause', 'resume', 'end']) });

export const rangeSchema = z
  .object({ from: isoDate, to: isoDate, employee_id: z.uuid().optional() })
  .refine((v) => v.from <= v.to, { message: 'from must be on or before to.', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 62, {
    message: 'Ask for at most 62 days at a time.',
    path: ['to'],
  });

/** SHF-4: an admin moves a punch to another time, or adds a missing one. */
export const editPunchSchema = z.strictObject({ occurredAt: z.iso.datetime({ offset: true }) });
export const addPunchSchema = z.strictObject({
  employeeId: z.uuid(),
  eventType: z.enum(['start', 'pause', 'end']),
  occurredAt: z.iso.datetime({ offset: true }),
});

/** SHF-5: the employee asks for different start and end times on one of their shifts. */
export const changeRequestSchema = z
  .strictObject({
    shiftDate: isoDate,
    requestedStart: z.iso.datetime({ offset: true }),
    requestedEnd: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1, 'Say why.').max(500),
  })
  .refine((v) => Date.parse(v.requestedEnd) > Date.parse(v.requestedStart), {
    message: 'End must be after start.',
    path: ['requestedEnd'],
  });

export const decisionSchema = z.strictObject({ decision: z.enum(['approve', 'reject']) });
export const listChangeRequestsSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});

export type SetShiftsInput = z.infer<typeof setShiftsSchema>;
export type PunchInput = z.infer<typeof punchSchema>;
export type RangeInput = z.infer<typeof rangeSchema>;
export type EditPunchInput = z.infer<typeof editPunchSchema>;
export type AddPunchInput = z.infer<typeof addPunchSchema>;
export type ChangeRequestInput = z.infer<typeof changeRequestSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
