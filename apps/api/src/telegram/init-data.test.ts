import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData } from './init-data';

const BOT = '1000000000:TESTONLYTELEGRAMBOTTOKENVALUE00001';
const NOW = 1_700_000_000;

function sign(fields: Record<string, string>, botToken = BOT): string {
  const keys = Object.keys(fields).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = keys.map((key) => `${key}=${fields[key]}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return [...keys, 'hash']
    .map((key) => `${key}=${encodeURIComponent(key === 'hash' ? hash : fields[key]!)}`)
    .join('&');
}

function fields(id: number, authDate = NOW): Record<string, string> {
  return {
    auth_date: String(authDate),
    query_id: 'AAE',
    user: JSON.stringify({
      id,
      first_name: 'Ada',
      last_name: 'Lovelace',
      username: 'ada',
      language_code: 'uz',
    }),
  };
}

describe('verifyTelegramInitData', () => {
  it('accepts a known vector and initData signed the way Telegram describes', () => {
    const vector =
      'auth_date=1700000000&query_id=AAE&user=%7B%22id%22%3A5220814834%2C%22first_name%22%3A%22Ada%22%2C%22last_name%22%3A%22Lovelace%22%2C%22username%22%3A%22ada%22%2C%22language_code%22%3A%22uz%22%7D&hash=9b440dc1fc4e914e717c63fc1c84658a4f1d6444a4804caa98b9fbe33ce9832d';
    expect(verifyTelegramInitData(vector, BOT, NOW, 900).ok).toBe(true);
    const result = verifyTelegramInitData(sign(fields(5220814834)), BOT, NOW, 900);
    expect(result).toEqual({
      ok: true,
      authDate: NOW,
      user: {
        id: 5220814834,
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: 'ada',
        languageCode: 'uz',
      },
    });
  });

  it('rejects a tampered user id, a wrong token, a swapped HMAC, and an expired stamp', () => {
    const signed = sign(fields(100));
    const params = new URLSearchParams(signed);
    const user = JSON.parse(params.get('user') ?? '{}') as { id: number };
    user.id = 5220814834;
    params.set('user', JSON.stringify(user));
    expect(verifyTelegramInitData(params.toString(), BOT, NOW, 900).ok).toBe(false);

    expect(verifyTelegramInitData(sign(fields(100), '999:OTHER'), BOT, NOW, 900)).toMatchObject({
      ok: false,
      reason: 'bad_hash',
    });

    const raw = fields(100);
    const keys = Object.keys(raw).sort();
    const dataCheckString = keys.map((key) => `${key}=${raw[key]}`).join('\n');
    const wrongHash = createHmac('sha256', BOT).update(dataCheckString).digest('hex');
    const forged = `${sign(raw).replace(/hash=[0-9a-f]+/, `hash=${wrongHash}`)}`;
    expect(verifyTelegramInitData(forged, BOT, NOW, 900)).toMatchObject({
      ok: false,
      reason: 'bad_hash',
    });

    expect(verifyTelegramInitData(sign(fields(100, NOW - 901)), BOT, NOW, 900)).toMatchObject({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects initData that has no user', () => {
    const onlyDate = sign({ auth_date: String(NOW), query_id: 'AAE' });
    expect(verifyTelegramInitData(onlyDate, BOT, NOW, 900)).toMatchObject({
      ok: false,
      reason: 'no_user',
    });
  });
});
