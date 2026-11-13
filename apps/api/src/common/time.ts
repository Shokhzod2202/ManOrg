import { z } from 'zod';

/** "HH:MM", 24-hour clock. */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour clock.');

/** Postgres TIME columns come back from Prisma as a Date on 1970-01-01 UTC. */
export function hhmmToTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00.000Z`);
}

export function timeToHhmm(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/** Day of the week (0 = Sunday) of `instant` in an IANA time zone. */
export function weekdayIn(timeZone: string, instant: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(instant);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}
