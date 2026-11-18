import { describe, expect, it } from 'vitest';
import { SERVER_TEXT, translate } from '../../src/common/i18n';
import { LINES, notificationText } from '../../src/telegram/telegram.text';

/** Phase 3: push, Telegram and the arrival reminder in Korean and Uzbek. */
const SAMPLE = {
  title: 'Clean ovens',
  dueDate: '2026-11-20',
  kind: 'contractor',
  ingredient: 'Flour',
  quantity: 2,
  name: 'Mina',
  date: '2026-11-18',
  message: 'Started 5 minutes late.',
  shiftDate: '2026-11-18',
  decision: 'approve',
  product: 'Bagel',
  amount: 12000,
  reason: 'Wrong receipt',
  startDate: '2026-11-01',
  endDate: '2026-11-15',
  closingBalance: 5000,
  deliveryDate: '2026-11-19',
  start: '06:00',
  end: '07:00',
};
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('server messages in the person’s language', () => {
  it('has Korean and Uzbek for every notification, with the same {holes}', () => {
    const templates = Object.values(LINES).flatMap((f) => [
      f(SAMPLE)[0],
      f({ ...SAMPLE, kind: 'employee', decision: 'reject', dueDate: null })[0],
    ]);
    for (const dict of Object.values(SERVER_TEXT)) {
      for (const tpl of templates) {
        expect(dict[tpl], tpl).toBeDefined();
        expect(holes(dict[tpl]!), tpl).toEqual(holes(tpl));
      }
    }
  });

  it('fills values after translating and escapes them for Telegram', () => {
    expect(notificationText('payment.approved', { amount: 12000 }, 'Sunrise', 'ko')).toBe(
      '<b>Sunrise</b>\n<b>12,000원</b> 입금이 승인되었습니다.',
    );
    expect(notificationText('task.assigned', { title: '<Ovens>' }, null, 'uz')).toBe(
      'Yangi vazifa: <b>&lt;Ovens&gt;</b>',
    );
    expect(notificationText('task.assigned', { title: 'Ovens' })).toBe('New task: <b>Ovens</b>');
    expect(translate('Not in the table', 'ko')).toBe('Not in the table');
  });
});
