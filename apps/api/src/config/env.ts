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
