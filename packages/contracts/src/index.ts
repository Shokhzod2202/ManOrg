import createClient, { type ClientOptions } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, operations, paths } from './schema';
export type Schemas = components['schemas'];

/** Typed REST client for /api/v1, shared by the web and mobile apps. */
export function createApiClient(options: ClientOptions = {}) {
  return createClient<paths>(options);
}
