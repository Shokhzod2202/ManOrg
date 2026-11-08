import { type INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './common/http-exception.filter';

/** Shared by main.ts and the integration tests so both run the same app. */
export function configureApp(app: INestApplication): void {
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
