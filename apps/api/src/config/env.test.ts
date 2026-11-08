import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const strong = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://manorg_app:independent-app-password-32@db:5432/manorg',
  JWT_ACCESS_SECRET: 'access-secret-production-value-32',
  JWT_REFRESH_SECRET: 'refresh-secret-production-value-32',
  TELEGRAM_BOT_TOKEN: `9193524838:${'A'.repeat(35)}`,
  TELEGRAM_WEBHOOK_SECRET: `webhook-secret-production-value-32`,
  TELEGRAM_BOOTSTRAP_ADMIN_IDS: '5220814834',
  TELEGRAM_WEBAPP_URL: 'https://bakery.haydar.store',
  TELEGRAM_BOOTSTRAP_TIMEZONE: 'Asia/Tashkent',
} satisfies NodeJS.ProcessEnv;

describe('parseEnv production', () => {
  it('accepts strong production settings and the intended admin id', () => {
    const parsed = parseEnv(strong);
    expect(parsed.bootstrapAdminIds).toEqual([5220814834n]);
    expect(parsed.bootstrapTimeZone).toBe('Asia/Tashkent');
    expect(parsed.TELEGRAM_WEBAPP_URL).toBe('https://bakery.haydar.store');
  });

  it('rejects development database passwords, known JWT placeholders, and a missing admin list', () => {
    expect(() =>
      parseEnv({
        ...strong,
        DATABASE_URL: 'postgresql://manorg_app:manorg_app_dev@db:5432/manorg',
      }),
    ).toThrow(/DATABASE_URL/);
    expect(() =>
      parseEnv({ ...strong, JWT_ACCESS_SECRET: 'ci-access-secret-not-used-outside-ci' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...strong, TELEGRAM_BOOTSTRAP_ADMIN_IDS: '' })).toThrow(
      /TELEGRAM_BOOTSTRAP_ADMIN_IDS/,
    );
    expect(() => parseEnv({ ...strong, TELEGRAM_BOT_TOKEN: 'not-a-token' })).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
    expect(() =>
      parseEnv({ ...strong, TELEGRAM_WEBAPP_URL: 'http://bakery.haydar.store' }),
    ).toThrow(/TELEGRAM_WEBAPP_URL/);
  });

  it('does not require Telegram settings outside production', () => {
    const parsed = parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://manorg_app:manorg_app_dev@localhost:5432/manorg_test',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef',
      JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789abcdef',
    });
    expect(parsed.bootstrapAdminIds).toEqual([]);
    expect(parsed.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });
});
