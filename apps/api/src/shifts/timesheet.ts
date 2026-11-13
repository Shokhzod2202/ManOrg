/**
 * Pure punch-card and shift arithmetic (spec SHF-3, SHF-6, section 4 and 7). No database, no
 * clock: callers pass "now", so every rule here is unit-tested.
 *
 * Rules
 * - Worked time is the sum of intervals from a start to the next pause or end; paused time is
 *   excluded (open question 7: paused time is unpaid).
 * - A start after a pause resumes the same shift. A shift paused and never resumed or ended counts
 *   as ended at the pause; a start more than RESUME_WINDOW_HOURS after a pause begins a new shift.
 * - A shift belongs to the local date it started on, so a night shift crossing midnight is one
 *   shift (spec section 4).
 * - A planned shift whose end time is not after its start ends on the next day (decided
 *   2026-11-13); every planned shift carries its start date and end date.
 */
export const RESUME_WINDOW_HOURS = 12;
/** After the planned end plus this, a shift with no End Shift is flagged (spec section 4). */
export const FORGOT_END_GRACE_MINUTES = 60;

export type PunchType = 'start' | 'pause' | 'end';

export interface PunchEventLike {
  id: string;
  eventType: PunchType;
  occurredAt: Date;
}

export type SessionStatus = 'working' | 'paused' | 'ended';

export interface Session {
  startedAt: Date;
  /** End Shift time, or the pause it ended at; null while working or paused, or when End Shift was forgotten. */
  endedAt: Date | null;
  status: SessionStatus;
  intervals: { from: Date; to: Date | null }[];
  events: PunchEventLike[];
}

export function buildSessions(events: PunchEventLike[], now: Date): Session[] {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const sessions: Session[] = [];
  let current: Session | null = null;
  let pausedAt: Date | null = null;
  const close = (s: Session, at: Date | null) => {
    s.endedAt = at;
    s.status = 'ended';
  };
  for (const e of sorted) {
    const t = e.occurredAt;
    if (e.eventType === 'start') {
      if (
        current &&
        current.status === 'paused' &&
        pausedAt &&
        t.getTime() - pausedAt.getTime() <= RESUME_WINDOW_HOURS * 3_600_000
      ) {
        current.intervals.push({ from: t, to: null });
        current.status = 'working';
        current.events.push(e);
        pausedAt = null;
        continue;
      }
      // A new start while a shift is still open: if paused, it ended at the pause; if working,
      // End Shift was forgotten, so it has no end and is flagged for the admin (spec section 4).
      if (current && current.status !== 'ended')
        close(current, current.status === 'paused' ? pausedAt : null);
      current = {
        startedAt: t,
        endedAt: null,
        status: 'working',
        intervals: [{ from: t, to: null }],
        events: [e],
      };
      sessions.push(current);
      pausedAt = null;
    } else if (e.eventType === 'pause') {
      if (!current || current.status !== 'working') continue;
      current.intervals.at(-1)!.to = t;
      current.status = 'paused';
      current.events.push(e);
      pausedAt = t;
    } else {
      if (!current || current.status === 'ended') continue;
      if (current.status === 'working') current.intervals.at(-1)!.to = t;
      current.events.push(e);
      close(current, t);
      current = null;
      pausedAt = null;
    }
  }
  // A shift paused too long ago counts as ended at the pause.
  if (
    current &&
    current.status === 'paused' &&
    pausedAt &&
    now.getTime() - pausedAt.getTime() > RESUME_WINDOW_HOURS * 3_600_000
  ) {
    close(current, pausedAt);
  }
  return sessions;
}

export function workedMinutes(session: Session, now: Date): number {
  let ms = 0;
  for (const i of session.intervals)
    ms += (i.to ?? (session.status === 'working' ? now : i.from)).getTime() - i.from.getTime();
  return Math.round(ms / 60_000);
}

export type PunchAction = 'start' | 'pause' | 'resume' | 'end';

/** Which punch buttons are valid now (SHF-3: start, then pause or end; resume after a pause). */
export function allowedActions(sessions: Session[]): PunchAction[] {
  const last = sessions.at(-1);
  if (!last || last.status === 'ended') return ['start'];
  if (last.status === 'working') return ['pause', 'end'];
  return ['resume', 'end'];
}

export interface PlannedShift {
  /** Local date the shift starts on. */
  startDate: string;
  /** Local date it ends on: the next day for a night shift. */
  endDate: string;
  startTime: string;
  endTime: string;
  plannedStart: Date;
  plannedEnd: Date;
}

export type FlagCode = 'LATE_START' | 'EARLY_END' | 'MISSING_PUNCH' | 'UNPLANNED' | 'NOT_ENDED';

export interface Flag {
  code: FlagCode;
  /** Difference in minutes, where it applies. */
  minutes?: number;
  message: string;
}

/**
 * SHF-6: compare one day's plan with what was punched. A difference beyond the tolerance (open
 * question 2, default 10 minutes) is a red flag; each flag carries text, not only colour.
 */
export function flagsFor(
  plan: PlannedShift | null,
  session: Session | null,
  toleranceMinutes: number,
  now: Date,
): Flag[] {
  const flags: Flag[] = [];
  const minutes = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 60_000);
  if (plan && !session) {
    if (now.getTime() > plan.plannedEnd.getTime() + toleranceMinutes * 60_000) {
      flags.push({ code: 'MISSING_PUNCH', message: 'Planned shift with no punch.' });
    }
    return flags;
  }
  if (!plan && session) {
    flags.push({ code: 'UNPLANNED', message: 'Punched with no planned shift.' });
    return flags;
  }
  if (!plan || !session) return flags;
  const late = minutes(session.startedAt, plan.plannedStart);
  if (late > toleranceMinutes)
    flags.push({ code: 'LATE_START', minutes: late, message: `Started ${late} minutes late.` });
  if (session.status === 'ended' && session.endedAt) {
    const early = minutes(plan.plannedEnd, session.endedAt);
    if (early > toleranceMinutes)
      flags.push({ code: 'EARLY_END', minutes: early, message: `Ended ${early} minutes early.` });
  } else if (now.getTime() > plan.plannedEnd.getTime() + FORGOT_END_GRACE_MINUTES * 60_000) {
    flags.push({ code: 'NOT_ENDED', message: 'Shift not ended after the planned end.' });
  }
  return flags;
}
