import { createApiClient } from '@manorg/contracts';

/**
 * Empty NEXT_PUBLIC_API_URL means the page and the API share an origin (the production proxy).
 * Unset means the local API on port 3001.
 */
export function apiOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured === undefined) return 'http://localhost:3001';
  return configured.replace(/\/$/, '');
}

export function apiV1(): string {
  return `${apiOrigin()}/api/v1`;
}

/** Typed client for the REST API; types come from packages/contracts/openapi.yaml. */
export const api = createApiClient({
  baseUrl: apiV1(),
});
