import { describe, expect, it } from 'vitest';
import { addDays, localDate, zonedToUtc } from '../common/time';
import {
  allowedActions,
  buildSessions,
  flagsFor,
  type PlannedShift,
  type PunchEventLike,
  workedMinutes,
} from './timesheet';

const TZ = 'Asia/Seoul';
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
let n = 0;
const ev = (
  eventType: PunchEventLike['eventType'],
  date: string,
  time: string,
): PunchEventLike => ({
  id: `e${(n += 1)}`,
  eventType,
  occurredAt: at(date, time),
});
const plan = (date: string, start: string, end: string): PlannedShift => {
  const endDate = end > start ? date : addDays(date, 1);
  return {
    startDate: date,
    endDate,
    startTime: start,
    endTime: end,
    plannedStart: at(date, start),
    plannedEnd: at(endDate, end),
  };
};
const later = at('2026-12-01', '00:00');

describe('time zone helpers', () => {
  it('converts Seoul wall-clock time to UTC and back', () => {
    expect(at('2026-11-02', '06:00').toISOString()).toBe('2026-11-01T21:00:00.000Z');
    expect(localDate(TZ, at('2026-11-02', '00:30'))).toBe('2026-11-02');
  });
});

describe('worked time (spec section 13 key scenarios)', () => {
  it('start 06:00, pause 10:00, start 10:30, end 14:00 gives 7.5 hours', () => {
    const [s] = buildSessions(
      [
        ev('start', '2026-11-02', '06:00'),
        ev('pause', '2026-11-02', '10:00'),
        ev('start', '2026-11-02', '10:30'),
        ev('end', '2026-11-02', '14:00'),
      ],
      later,
    );
    expect(workedMinutes(s!, later)).toBe(450);
    expect(s!.status).toBe('ended');
  });

  it('counts a running shift up to now', () => {
    const now = at('2026-11-02', '08:15');
    const [s] = buildSessions([ev('start', '2026-11-02', '06:00')], now);
    expect([s!.status, workedMinutes(s!, now)]).toEqual(['working', 135]);
  });

  it('treats a shift paused and never resumed as ended at the pause', () => {
    const sessions = buildSessions(
      [ev('start', '2026-11-02', '06:00'), ev('pause', '2026-11-02', '10:00')],
      later,
    );
    expect(sessions[0]).toMatchObject({ status: 'ended', endedAt: at('2026-11-02', '10:00') });
    expect(workedMinutes(sessions[0]!, later)).toBe(240);
  });

  it('starts a new shift when the next start is long after a pause', () => {
    const sessions = buildSessions(
      [
        ev('start', '2026-11-02', '06:00'),
        ev('pause', '2026-11-02', '10:00'),
        ev('start', '2026-11-03', '06:00'),
      ],
      later,
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.endedAt).toEqual(at('2026-11-02', '10:00'));
  });

  it('leaves a forgotten End Shift without an end instead of counting the night', () => {
    const sessions = buildSessions(
      [ev('start', '2026-11-02', '06:00'), ev('start', '2026-11-03', '06:00')],
      later,
    );
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ status: 'ended', endedAt: null });
    expect(workedMinutes(sessions[0]!, later)).toBe(0);
    expect(flagsFor(plan('2026-11-02', '06:00', '14:00'), sessions[0]!, 10, later)[0]?.code).toBe(
      'NOT_ENDED',
    );
  });

  it('keeps a night shift crossing midnight as one shift on its start date', () => {
    const sessions = buildSessions(
      [ev('start', '2026-11-01', '22:00'), ev('end', '2026-11-02', '06:00')],
      later,
    );
    expect(sessions).toHaveLength(1);
    expect(localDate(TZ, sessions[0]!.startedAt)).toBe('2026-11-01');
    expect(workedMinutes(sessions[0]!, later)).toBe(480);
  });
});

describe('punch buttons (SHF-3)', () => {
  it('offer start, then pause or end, then resume or end', () => {
    expect(allowedActions([])).toEqual(['start']);
    const now = at('2026-11-02', '09:00');
    expect(allowedActions(buildSessions([ev('start', '2026-11-02', '06:00')], now))).toEqual([
      'pause',
      'end',
    ]);
    expect(
      allowedActions(
        buildSessions(
          [ev('start', '2026-11-02', '06:00'), ev('pause', '2026-11-02', '08:00')],
          now,
        ),
      ),
    ).toEqual(['resume', 'end']);
    expect(
      allowedActions(
        buildSessions([ev('start', '2026-11-02', '06:00'), ev('end', '2026-11-02', '08:00')], now),
      ),
    ).toEqual(['start']);
  });
});

describe('red flags (SHF-6)', () => {
  it('planned 06:00 to 14:00, punched 06:25 to 14:00 is red with a 25-minute difference', () => {
    const [s] = buildSessions(
      [ev('start', '2026-11-02', '06:25'), ev('end', '2026-11-02', '14:00')],
      later,
    );
    expect(flagsFor(plan('2026-11-02', '06:00', '14:00'), s!, 10, later)).toEqual([
      { code: 'LATE_START', minutes: 25, message: 'Started 25 minutes late.' },
    ]);
  });

  it('stays clear within the tolerance', () => {
    const [s] = buildSessions(
      [ev('start', '2026-11-02', '06:08'), ev('end', '2026-11-02', '13:55')],
      later,
    );
    expect(flagsFor(plan('2026-11-02', '06:00', '14:00'), s!, 10, later)).toEqual([]);
  });

  it('flags an early end, a missing punch, an unplanned shift and a forgotten End Shift', () => {
    const [early] = buildSessions(
      [ev('start', '2026-11-02', '06:00'), ev('end', '2026-11-02', '12:00')],
      later,
    );
    expect(flagsFor(plan('2026-11-02', '06:00', '14:00'), early!, 10, later)[0]).toMatchObject({
      code: 'EARLY_END',
      minutes: 120,
    });
    expect(flagsFor(plan('2026-11-02', '06:00', '14:00'), null, 10, later)[0]?.code).toBe(
      'MISSING_PUNCH',
    );
    const [unplanned] = buildSessions([ev('start', '2026-11-02', '06:00')], later);
    expect(flagsFor(null, unplanned!, 10, later)[0]?.code).toBe('UNPLANNED');
    const now = at('2026-11-02', '15:30');
    const [open] = buildSessions([ev('start', '2026-11-02', '06:00')], now);
    expect(flagsFor(plan('2026-11-02', '06:00', '14:00'), open!, 10, now)[0]?.code).toBe(
      'NOT_ENDED',
    );
  });

  it('does not flag a missing punch before the shift is over', () => {
    expect(
      flagsFor(plan('2026-11-02', '06:00', '14:00'), null, 10, at('2026-11-02', '10:00')),
    ).toEqual([]);
  });

  it('compares a night shift with its next-day end', () => {
    const p = plan('2026-11-01', '22:00', '06:00');
    expect([p.startDate, p.endDate]).toEqual(['2026-11-01', '2026-11-02']);
    const [s] = buildSessions(
      [ev('start', '2026-11-01', '22:05'), ev('end', '2026-11-02', '06:00')],
      later,
    );
    expect(flagsFor(p, s!, 10, later)).toEqual([]);
  });
});
