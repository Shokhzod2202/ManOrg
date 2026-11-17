import { type INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter';

/** Shared by main.ts and the integration tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  // The web server forwards /api/v1 (and sign-in) here; trust only that hop for the client IP,
  // so rate limits count real people, not the web server (TRUST_PROXY, default loopback).
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set(
    'trust proxy',
    process.env.TRUST_PROXY ?? 'loopback',
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-Organization-Id',
      'If-Match',
      'Idempotency-Key',
    ],
    exposedHeaders: ['ETag'],
  });
  app.enableShutdownHooks();
}
