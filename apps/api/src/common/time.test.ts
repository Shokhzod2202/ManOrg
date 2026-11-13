import { describe, expect, it } from 'vitest';
import { hhmmToTime, timeToHhmm, weekdayIn } from './time';

describe('time helpers', () => {
  it('round-trips HH:MM through a TIME value', () => {
    expect(timeToHhmm(hhmmToTime('18:05'))).toBe('18:05');
  });

  it('reads the weekday in the organization time zone, not UTC', () => {
    // 2026-11-01 16:00 UTC is Sunday in UTC but Monday 01:00 in Seoul.
    const instant = new Date('2026-11-01T16:00:00Z');
    expect(weekdayIn('UTC', instant)).toBe(0);
    expect(weekdayIn('Asia/Seoul', instant)).toBe(1);
  });
});
