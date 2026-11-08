import { createApiClient } from '@manorg/contracts';

/** Typed client for the REST API; types come from packages/contracts/openapi.yaml. */
export const api = createApiClient({
  baseUrl: `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/v1`,
});
