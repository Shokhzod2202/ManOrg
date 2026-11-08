import { describe, expect, it } from 'vitest';
import { assertReapplyAllowed } from './memberships';

describe('assertReapplyAllowed', () => {
  const rejected = new Date('2026-11-01T00:00:00Z');

  it('allows applying when there was no rejection', () => {
    expect(() => assertReapplyAllowed(null)).not.toThrow();
  });

  it('blocks re-applying within 7 days of a rejection', () => {
    expect(() => assertReapplyAllowed(rejected, new Date('2026-11-07T23:59:59Z'))).toThrow(
      expect.objectContaining({ code: 'REAPPLY_TOO_SOON' }),
    );
  });

  it('allows re-applying from day 7', () => {
    expect(() => assertReapplyAllowed(rejected, new Date('2026-11-08T00:00:00Z'))).not.toThrow();
  });
});
