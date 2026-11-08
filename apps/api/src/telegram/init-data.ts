import { createHmac, timingSafeEqual } from 'node:crypto';

export type InitDataFailure = 'malformed' | 'bad_hash' | 'expired' | 'no_user';

export interface VerifiedTelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
}

export type VerifyInitDataResult =
  | { ok: true; user: VerifiedTelegramUser; authDate: number }
  | { ok: false; reason: InitDataFailure };

const MAX_INIT_DATA_LENGTH = 8192;
const FUTURE_SKEW_SECONDS = 30;

/**
 * Checks Telegram Mini App initData with the bot token.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * secret_key = HMAC_SHA256(key "WebAppData", message bot_token)
 * hash = hex(HMAC_SHA256(key secret_key, message data_check_string))
 * data_check_string is every field except hash, sorted by key, joined with newlines.
 * The `signature` field, when Telegram sends one, stays in the data-check string.
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds: number,
  maxAgeSeconds: number,
): VerifyInitDataResult {
  if (!initData || initData.length > MAX_INIT_DATA_LENGTH || !botToken) {
    return { ok: false, reason: 'malformed' };
  }
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hash = params.get('hash')?.toLowerCase();
  if (!hash) return { ok: false, reason: 'bad_hash' };
  params.delete('hash');
  const pairs: [string, string][] = [];
  for (const [key, value] of params.entries()) pairs.push([key, value]);
  if (pairs.length === 0) return { ok: false, reason: 'malformed' };
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!hexEqual(computed, hash)) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate)) return { ok: false, reason: 'expired' };
  const age = nowSeconds - authDate;
  if (age > maxAgeSeconds || age < -FUTURE_SKEW_SECONDS) return { ok: false, reason: 'expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'no_user' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: 'no_user' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'no_user' };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.id !== 'number' || !Number.isSafeInteger(record.id) || record.id <= 0) {
    return { ok: false, reason: 'no_user' };
  }
  const firstName = typeof record.first_name === 'string' ? record.first_name : '';
  const lastName = typeof record.last_name === 'string' ? record.last_name : undefined;
  const username =
    typeof record.username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(record.username)
      ? record.username
      : undefined;
  const languageCode =
    typeof record.language_code === 'string' && record.language_code.length <= 16
      ? record.language_code
      : undefined;
  return {
    ok: true,
    authDate,
    user: { id: record.id, firstName, lastName, username, languageCode },
  };
}

function hexEqual(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}
