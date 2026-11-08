/**
 * The OpenAPI file is the single contract (spec section 8). This test fails when a route exists in
 * the API but not in openapi.yaml, or the other way round, or when the contract misdescribes how a
 * route is protected.
 */
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module';
import { IS_PUBLIC, ORG_REQUIREMENT, type OrgRequirement } from '../../src/common/request-context';
import { loadOpenApi, requiresOrgHeader } from '../helpers/openapi';

interface Route {
  key: string;
  isPublic: boolean;
  org: OrgRequirement | undefined;
}

type Ctor = new (...args: never[]) => object;

/** Controllers of a module and every module it imports (static or dynamic). */
function controllersOf(mod: unknown, seen = new Set<unknown>()): Ctor[] {
  const target = (mod as { module?: unknown })?.module ?? mod;
  if (!target || seen.has(target)) return [];
  seen.add(target);
  const own = (Reflect.getMetadata('controllers', target as object) ?? []) as Ctor[];
  const dynamic = ((mod as { controllers?: Ctor[] })?.controllers ?? []) as Ctor[];
  const imports = (Reflect.getMetadata('imports', target as object) ?? []) as unknown[];
  return [...own, ...dynamic, ...imports.flatMap((m) => controllersOf(m, seen))];
}

function nestRoutes(): Route[] {
  const controllers = [...new Set(controllersOf(AppModule))];
  const routes: Route[] = [];
  for (const controller of controllers) {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const classPublic = Reflect.getMetadata(IS_PUBLIC, controller) === true;
    const classOrg = Reflect.getMetadata(ORG_REQUIREMENT, controller) as OrgRequirement | undefined;
    const proto = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      const sub = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const full = `/${[base, sub].filter((s) => s && s !== '/').join('/')}`
        .replace(/\/+/g, '/')
        .replace(/:(\w+)/g, '{$1}');
      routes.push({
        key: `${RequestMethod[method]} ${full === '/' ? '/' : full.replace(/\/$/, '')}`,
        isPublic: classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true,
        org:
          (Reflect.getMetadata(ORG_REQUIREMENT, handler) as OrgRequirement | undefined) ?? classOrg,
      });
    }
  }
  return routes;
}

const { doc, operations } = loadOpenApi();
const routes = nestRoutes();

describe('openapi.yaml matches the API', () => {
  it('documents every route and only real routes', () => {
    const inApi = routes.map((r) => r.key).sort();
    const inContract = operations.map((op) => `${op.method} ${op.path}`).sort();
    expect(inContract).toEqual(inApi);
  });

  it('marks exactly the public routes as needing no token', () => {
    const contractPublic = operations
      .filter((op) => Array.isArray(op.security) && op.security.length === 0)
      .map((op) => `${op.method} ${op.path}`)
      .sort();
    expect(contractPublic).toEqual(
      routes
        .filter((r) => r.isPublic)
        .map((r) => r.key)
        .sort(),
    );
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
  });

  it('requires X-Organization-Id exactly where the API does', () => {
    const contractRequired = operations
      .filter(requiresOrgHeader)
      .map((op) => `${op.method} ${op.path}`)
      .sort();
    const apiRequired = routes
      .filter((r) => r.org?.kind === 'required')
      .map((r) => r.key)
      .sort();
    expect(contractRequired).toEqual(apiRequired);
  });

  it('documents 401 on every protected route and 403/404 on organization routes', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    const missing: string[] = [];
    for (const op of operations) {
      const route = byKey.get(`${op.method} ${op.path}`);
      if (!route) continue;
      const codes = Object.keys(op.responses);
      if (!route.isPublic && !codes.includes('401')) missing.push(`${op.operationId}: 401`);
      if (route.org?.kind === 'required') {
        for (const code of ['403', '404'])
          if (!codes.includes(code)) missing.push(`${op.operationId}: ${code}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
