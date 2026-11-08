import { type INestApplication } from '@nestjs/common';

/** Shared by main.ts and the integration tests so both run the same app. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
}
