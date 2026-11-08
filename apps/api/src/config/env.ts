import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

const KNOWN_SECRETS = new Set([
  'ci-access-secret-not-used-outside-ci',
  'ci-refresh-secret-not-used-outside-ci',
  'test-access-secret-0123456789abcdef',
  'test-refresh-secret-0123456789abcdef',
]);

const DEV_DATABASE_MARKERS = ['manorg_app_dev', 'manorg_owner_dev', 'postgres_dev', 'Password123!'];

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** Requests per minute per client on the sign-in endpoints (spec section 12). */
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    APP_TIMEZONE_DEFAULT: z.string().default('Asia/Seoul'),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    TELEGRAM_BOOTSTRAP_ADMIN_IDS: z.string().optional(),
    TELEGRAM_BOOTSTRAP_ORG_NAME: z.string().trim().min(1).max(120).default('Shohona Bakery'),
    TELEGRAM_BOOTSTRAP_TIMEZONE: z.string().optional(),
    TELEGRAM_WEBAPP_URL: z.string().optional(),
    TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().max(86_400).default(900),
    TELEGRAM_API_BASE: z.string().default('https://api.telegram.org'),
  })
  .superRefine((data, ctx) => {
    const adminIds = readAdminIds(data.TELEGRAM_BOOTSTRAP_ADMIN_IDS);
    if (!adminIds.ok) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOOTSTRAP_ADMIN_IDS'],
        message: 'must be a comma-separated list of positive Telegram user ids',
      });
    }
    if (data.TELEGRAM_BOOTSTRAP_TIMEZONE && !isTimeZone(data.TELEGRAM_BOOTSTRAP_TIMEZONE)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOOTSTRAP_TIMEZONE'],
        message: 'must be an IANA time zone',
      });
    }
    if (data.NODE_ENV !== 'production') return;

    const weakSecret = (name: string, value: string) => {
      if (value.length < 32 || KNOWN_SECRETS.has(value)) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'must be a unique secret of at least 32 characters',
        });
      }
    };
    weakSecret('JWT_ACCESS_SECRET', data.JWT_ACCESS_SECRET);
    weakSecret('JWT_REFRESH_SECRET', data.JWT_REFRESH_SECRET);
    if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must be different from JWT_ACCESS_SECRET',
      });
    }
    if (DEV_DATABASE_MARKERS.some((marker) => data.DATABASE_URL.includes(marker))) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'must not use a development password',
      });
    }
    const token = blankToUndefined(data.TELEGRAM_BOT_TOKEN);
    if (!token || !/^[0-9]{6,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOT_TOKEN'],
        message: 'must be a Telegram bot token',
      });
    }
    const webhookSecret = blankToUndefined(data.TELEGRAM_WEBHOOK_SECRET);
    if (!webhookSecret || webhookSecret.length < 32 || KNOWN_SECRETS.has(webhookSecret)) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBHOOK_SECRET'],
        message: 'must be a unique secret of at least 32 characters',
      });
    }
    if (!adminIds.ok || adminIds.ids.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_BOOTSTRAP_ADMIN_IDS'],
        message: 'must list the Telegram user ids that may become the bakery admin',
      });
    }
    const webAppUrl = blankToUndefined(data.TELEGRAM_WEBAPP_URL);
    if (!webAppUrl || !webAppUrl.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_WEBAPP_URL'],
        message: 'must be the https URL of the Mini App',
      });
    }
    if (!data.TELEGRAM_API_BASE.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['TELEGRAM_API_BASE'],
        message: 'must be https',
      });
    }
  })
  .transform((data) => {
    const adminIds = readAdminIds(data.TELEGRAM_BOOTSTRAP_ADMIN_IDS);
    const timezone = blankToUndefined(data.TELEGRAM_BOOTSTRAP_TIMEZONE);
    return {
      ...data,
      TELEGRAM_BOT_TOKEN: blankToUndefined(data.TELEGRAM_BOT_TOKEN),
      TELEGRAM_WEBHOOK_SECRET: blankToUndefined(data.TELEGRAM_WEBHOOK_SECRET),
      TELEGRAM_WEBAPP_URL: blankToUndefined(data.TELEGRAM_WEBAPP_URL),
      bootstrapAdminIds: adminIds.ok ? adminIds.ids : [],
      bootstrapTimeZone: timezone && isTimeZone(timezone) ? timezone : data.APP_TIMEZONE_DEFAULT,
    };
  });

export type Env = z.output<typeof schema>;

let cached: Env | undefined;

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function readAdminIds(
  raw: string | undefined,
): { ok: true; ids: bigint[] } | { ok: false; ids: [] } {
  const trimmed = raw?.trim();
  if (!trimmed) return { ok: true, ids: [] };
  const ids: bigint[] = [];
  const seen = new Set<string>();
  for (const part of trimmed.split(',')) {
    const value = part.trim();
    if (!/^[1-9][0-9]{0,18}$/.test(value)) return { ok: false, ids: [] };
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(BigInt(value));
  }
  return { ok: true, ids };
}

/** Validated environment. Throws at startup with the names of missing variables, never values. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${names}`);
  }
  return parsed.data;
}

/** Validated environment. Throws at startup with the names of missing variables, never values. */
export function env(): Env {
  if (!cached) cached = parseEnv(process.env);
  return cached;
}

/** Tests change process.env between app instances. */
export function resetEnvCache(): void {
  cached = undefined;
}
