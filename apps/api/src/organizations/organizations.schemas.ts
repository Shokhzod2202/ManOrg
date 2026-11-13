import { z } from 'zod';
import { paginationSchema } from '../common/pagination';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** ACC-4: a name and a type; location is optional and used by the phase 2 start-shift prompt. */
export const createOrganizationSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name.').max(120, 'Use at most 120 characters.'),
  type: z.enum(['provider', 'contractor']),
  timezone: z.string().refine(isTimeZone, 'Unknown time zone.').optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

export const searchOrganizationsSchema = paginationSchema.extend({
  q: z.string().trim().max(120).default(''),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type SearchOrganizationsInput = z.infer<typeof searchOrganizationsSchema>;
