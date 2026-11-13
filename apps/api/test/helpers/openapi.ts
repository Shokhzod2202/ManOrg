import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export interface Operation {
  method: string;
  path: string;
  operationId: string;
  tenantScoped: boolean | undefined;
  /** Who calls it in the isolation suite when not the admin: `contractor`. */
  actor: string | undefined;
  security: unknown[] | undefined;
  parameters: { $ref?: string; name?: string; in?: string }[];
  responses: Record<string, unknown>;
}

export interface OpenApiDoc {
  security?: unknown[];
  paths: Record<
    string,
    Record<
      string,
      Omit<Operation, 'method' | 'path' | 'tenantScoped' | 'actor'> & {
        'x-tenant-scoped'?: boolean;
        'x-tenant-actor'?: string;
      }
    >
  >;
}

export const OPENAPI_PATH = path.resolve(__dirname, '../../../../packages/contracts/openapi.yaml');

export function loadOpenApi(): { doc: OpenApiDoc; operations: Operation[] } {
  const doc = parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiDoc;
  const operations: Operation[] = [];
  for (const [p, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      operations.push({
        method: method.toUpperCase(),
        path: p,
        operationId: op.operationId,
        tenantScoped: op['x-tenant-scoped'],
        actor: op['x-tenant-actor'],
        security: op.security,
        parameters: op.parameters ?? [],
        responses: op.responses ?? {},
      });
    }
  }
  return { doc, operations };
}

export function requiresOrgHeader(op: Operation): boolean {
  return op.parameters.some((p) => p.$ref === '#/components/parameters/OrganizationId');
}
