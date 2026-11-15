import { describe, expect, it } from 'vitest';
import { formatMinutes, today } from './api';

describe('web helpers', () => {
  it('formats worked minutes', () => {
    expect(formatMinutes(5)).toBe('5 min');
    expect(formatMinutes(125)).toBe('2 h 5 min');
  });

  it('gives the calendar date in the organization time zone', () => {
    expect(today('Asia/Seoul')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const a = new Date(`${today('Asia/Seoul')}T00:00:00Z`).getTime();
    const b = new Date(`${today('Asia/Seoul', 1)}T00:00:00Z`).getTime();
    expect(b - a).toBe(86_400_000);
  });
});
