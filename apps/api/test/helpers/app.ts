import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';
import { resetEnvCache } from '../../src/config/env';
import { type AuditLog } from '../../src/generated/prisma/client';
import { asOwner } from './db';

export async function createTestApp(
  envOverrides: Record<string, string> = {},
): Promise<INestApplication> {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envOverrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  resetEnvCache();
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    return app;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetEnvCache();
  }
}

export interface Session {
  userId: string;
  email: string;
  name: string;
  accessToken: string;
  refreshToken: string;
}

let seq = 0;

/** Thin helpers over the real HTTP API, used to build fixtures the way clients would. */
export class Api {
  constructor(readonly app: INestApplication) {}

  get http() {
    return request(this.app.getHttpServer());
  }

  async register(name: string): Promise<Session> {
    seq += 1;
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${seq}@test.local`;
    const res = await this.http
      .post('/api/v1/auth/register')
      .send({ name, email, password: 'Password123!' })
      .expect(201);
    return {
      userId: res.body.user.id,
      email,
      name,
      accessToken: res.body.tokens.accessToken,
      refreshToken: res.body.tokens.refreshToken,
    };
  }

  as(session: Session, organizationId?: string) {
    const auth = (r: request.Test) => {
      r.set('Authorization', `Bearer ${session.accessToken}`);
      if (organizationId) r.set('X-Organization-Id', organizationId);
      return r;
    };
    return {
      get: (url: string) => auth(this.http.get(`/api/v1${url}`)),
      post: (url: string) => auth(this.http.post(`/api/v1${url}`)),
      patch: (url: string) => auth(this.http.patch(`/api/v1${url}`)),
      put: (url: string) => auth(this.http.put(`/api/v1${url}`)),
    };
  }

  async createOrganization(admin: Session, name: string, type: 'bakery' | 'contractor' = 'bakery') {
    const res = await this.as(admin).post('/organizations').send({ name, type }).expect(201);
    return res.body.organization.id as string;
  }

  /** Registers a person, applies them to the bakery and approves them. */
  async hireEmployee(
    bakeryId: string,
    admin: Session,
    name: string,
  ): Promise<Session & { membershipId: string }> {
    const person = await this.register(name);
    const applied = await this.as(person)
      .post(`/organizations/${bakeryId}/applications`)
      .expect(201);
    await this.as(admin, bakeryId).post(`/applications/${applied.body.id}/approve`).expect(200);
    return { ...person, membershipId: applied.body.id };
  }
}

/** Smallest bytes that are recognized as a PNG picture. */
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);

/** Uploads a picture and creates a product with one ingredient. */
export async function createProduct(
  api: Api,
  admin: Session,
  orgId: string,
  ingredientId: string,
  name = 'Bread',
): Promise<string> {
  const image = await api
    .as(admin, orgId)
    .post('/product-images')
    .attach('file', PNG, 'bread.png')
    .expect(201);
  const product = await api
    .as(admin, orgId)
    .post('/products')
    .send({
      name,
      imageKey: image.body.imageKey,
      minutesPer10: 12,
      ingredients: [{ ingredientId }],
    })
    .expect(201);
  return product.body.id as string;
}

/** Audit entries for one entity, read inside the organization (or as the actor when account-level). */
export async function auditFor(
  entityId: string,
  ctx: { organizationId: string | null; userId: string },
): Promise<AuditLog[]> {
  return asOwner(ctx, (tx) =>
    tx.auditLog.findMany({ where: { entityId }, orderBy: { at: 'asc' } }),
  );
}
