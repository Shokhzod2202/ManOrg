import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

const schema = z.object({
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
  /** `local` keeps files on disk (development, tests); `s3` uses an S3-compatible bucket. */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default(path.resolve(__dirname, '../../../../.storage')),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().default('ap-northeast-2'),
  STORAGE_KEY: z.string().optional(),
  STORAGE_SECRET: z.string().optional(),
  /** Public base URL of the API, used in signed file links served by the local driver. */
  PUBLIC_API_URL: z.string().default('http://localhost:3001'),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** Redis for scheduled jobs (BullMQ). */
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** `true` on the API instances that should run scheduled jobs; any number may, each job runs once. */
  JOBS_ENABLED: z.enum(['true', 'false']).default('false'),
  /** Queue name; separate names keep test runs apart from a running server. */
  JOBS_QUEUE: z.string().default('manorg-jobs'),
  /** AI bot (spec section 10): the model sits behind a provider interface (open question 12). */
  LLM_PROVIDER: z.enum(['', 'anthropic', 'xai']).default(''),
  /** A secret: only in the server environment. For anthropic, ANTHROPIC_API_KEY also works. */
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  /** Optional: a gateway in front of the provider's API (also used by local checks). */
  LLM_BASE_URL: z.string().optional(),
  LLM_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  /** Decided 2026-11-29: requests a minute for each outside bot's API key. */
  AGENT_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  BOT_MESSAGES_PER_MINUTE: z.coerce.number().int().positive().default(10),
  BOT_MONTHLY_TOKEN_BUDGET: z.coerce.number().int().positive().default(2_000_000),
  BOT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  /** Phone push through Expo's push service (FCM and APNs behind it). */
  EXPO_PUSH_URL: z.string().default('https://exp.host/--/api/v2/push/send'),
  /** Optional: required when "enhanced push security" is on in the Expo project. A secret. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Telegram bot (decided 2026-11-13). A secret: only in the server's environment, never in git. */
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().default('haydar_inc_bot'),
  TELEGRAM_API_URL: z.string().default('https://api.telegram.org'),
  /** Set to receive updates by webhook (production); Telegram sends it back in a header. */
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),
  /** `true` to fetch updates by long polling (development, or no public URL). */
  TELEGRAM_POLLING: z.enum(['true', 'false']).default('false'),
  /** The web app, for links in bot messages. */
  WEB_APP_URL: z.string().default('http://localhost:3000'),
  /**
   * Decided 2026-11-29: email (password reset links). An SMTP URL such as
   * smtps://user:password@smtp.example.com:465. Not set: emails are written to the API log.
   */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Haydar Systems <no-reply@haydar.local>'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Throws at startup with the names of missing variables, never values. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
      throw new Error(`Invalid environment: ${names}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Tests change process.env between app instances. */
export function resetEnvCache(): void {
  cached = undefined;
}
