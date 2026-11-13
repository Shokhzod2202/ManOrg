import { describe, expect, it } from 'vitest';
import { zonedToUtc } from '../common/time';
import { defaultDeliveryDate, diffLines } from './order-dates';

const TZ = 'Asia/Seoul';

describe('defaultDeliveryDate (decided 2026-11-13)', () => {
  it('suggests today and asks before 10:00', () => {
    expect(defaultDeliveryDate(TZ, zonedToUtc('2026-11-02', '00:30', TZ))).toEqual({
      date: '2026-11-02',
      askIfToday: true,
    });
    expect(defaultDeliveryDate(TZ, zonedToUtc('2026-11-02', '09:59', TZ))).toEqual({
      date: '2026-11-02',
      askIfToday: true,
    });
  });

  it('suggests the next day from 10:00', () => {
    expect(defaultDeliveryDate(TZ, zonedToUtc('2026-11-01', '20:00', TZ))).toEqual({
      date: '2026-11-02',
      askIfToday: false,
    });
    expect(defaultDeliveryDate(TZ, zonedToUtc('2026-11-02', '10:00', TZ))).toEqual({
      date: '2026-11-03',
      askIfToday: false,
    });
  });
});

describe('diffLines', () => {
  it('splits a requested change into per-product items', () => {
    expect(
      diffLines(
        [
          { productId: 'bread', quantity: 30 },
          { productId: 'somsa', quantity: 30 },
          { productId: 'burger', quantity: 10 },
        ],
        [
          { productId: 'bread', quantity: 40 },
          { productId: 'somsa', quantity: 20 },
          { productId: 'pilaf', quantity: 5 },
        ],
      ),
    ).toEqual([
      { productId: 'bread', from: 30, to: 40, kind: 'increase' },
      { productId: 'somsa', from: 30, to: 20, kind: 'decrease' },
      { productId: 'burger', from: 10, to: 0, kind: 'remove' },
      { productId: 'pilaf', from: 0, to: 5, kind: 'add' },
    ]);
  });

  it('is empty when nothing changes', () => {
    expect(diffLines([{ productId: 'a', quantity: 1 }], [{ productId: 'a', quantity: 1 }])).toEqual(
      [],
    );
  });
});
