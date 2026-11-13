import { describe, expect, it } from 'vitest';
import { creditFor, expectedMinutes, type LineLike, totalsByProduct } from './calc';

const line = (p: Partial<LineLike>): LineLike => ({
  productId: 'bread',
  quantity: 0,
  minutesPer10: 12,
  teamId: null,
  teamMemberIds: [],
  employeeId: 'mina',
  ...p,
});

describe('output calculations', () => {
  it('expected time is quantity / 10 x minutes per 10', () => {
    expect(expectedMinutes(30, 12)).toBe(36);
  });

  it('Self Bread 30 plus Team A Pilaf 30 (OUT-6): team counted once, shared equally', () => {
    const lines = [
      line({ productId: 'bread', quantity: 30 }),
      line({
        productId: 'pilaf',
        quantity: 30,
        minutesPer10: 20,
        teamId: 'A',
        teamMemberIds: ['mina', 'joon'],
      }),
    ];
    expect(totalsByProduct(lines)).toEqual(
      new Map([
        ['bread', 30],
        ['pilaf', 30],
      ]),
    );
    expect(creditFor('mina', lines)).toEqual({ creditedQuantity: 45, expectedMinutes: 66 });
    expect(creditFor('joon', lines)).toEqual({ creditedQuantity: 15, expectedMinutes: 30 });
  });

  it('Pilaf 30 by a team of 3 credits 10 each', () => {
    const lines = [line({ quantity: 30, teamId: 'A', teamMemberIds: ['a', 'b', 'c'] })];
    expect(creditFor('b', lines).creditedQuantity).toBe(10);
  });

  it('does not credit people outside the team or other people’s personal lines', () => {
    const lines = [
      line({ quantity: 30, employeeId: 'joon' }),
      line({ quantity: 30, teamId: 'A', teamMemberIds: ['joon'] }),
    ];
    expect(creditFor('mina', lines)).toEqual({ creditedQuantity: 0, expectedMinutes: 0 });
  });
});
