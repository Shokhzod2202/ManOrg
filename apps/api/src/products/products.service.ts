import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { type Prisma } from '../generated/prisma/client';
import { CONTENT_TYPES, newKey, parseKey, sniffImage } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import {
  type CreateProductInput,
  type SetEmployeeProductsInput,
  type UpdateProductInput,
} from './products.schemas';

/** Product pictures: JPEG, PNG or WebP up to 5 MB, detected from the bytes. */
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

const include = {
  ingredients: {
    include: { ingredient: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ProductInclude;

type Row = Prisma.ProductGetPayload<{ include: typeof include }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Stores a product picture and returns the key to send with the product. */
  async uploadImage(org: OrgContext, file: Express.Multer.File | undefined) {
    if (!file) throw Errors.validation({ file: ['Attach a picture.'] });
    if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
      throw Errors.validation({ file: ['Use a picture of at most 5 MB.'] });
    }
    const ext = sniffImage(file.buffer);
    if (!ext) throw Errors.validation({ file: ['Use a JPEG, PNG or WebP picture.'] });
    const key = newKey(org.organizationId, 'product', ext);
    await this.storage.put(key, file.buffer, CONTENT_TYPES[ext]);
    return { imageKey: key, imageUrl: await this.storage.signedUrl(key) };
  }

  list(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.product.findMany({
        where: { organizationId: org.organizationId, deletedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include,
      });
      return { items: await Promise.all(rows.map((r) => this.present(r))), nextCursor: null };
    });
  }

  get(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) =>
      this.present(await this.find(tx, org, id)),
    );
  }

  create(user: AuthUser, org: OrgContext, input: CreateProductInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.assertImage(org, input.imageKey);
      await this.assertIngredients(tx, org, input.ingredients);
      const product = await tx.product.create({
        data: {
          organizationId: org.organizationId,
          name: input.name,
          imageUrl: input.imageKey,
          minutesPer10: input.minutesPer10,
          available: input.available,
          // organization_id comes from the product through the composite key.
          ingredients: {
            create: input.ingredients.map((i) => ({
              ingredientId: i.ingredientId,
              quantityPer10: i.quantityPer10 ?? null,
            })),
          },
        },
        include,
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'product.create',
        entity: 'product',
        entityId: product.id,
        after: snapshot(product),
      });
      return this.present(product);
    });
  }

  update(user: AuthUser, org: OrgContext, id: string, version: number, input: UpdateProductInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.find(tx, org, id);
      if (before.version !== version) throw Errors.versionConflict();
      if (input.imageKey !== undefined) await this.assertImage(org, input.imageKey);
      if (input.ingredients) await this.assertIngredients(tx, org, input.ingredients);
      const result = await tx.product.updateMany({
        where: { id, version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.imageKey !== undefined ? { imageUrl: input.imageKey } : {}),
          ...(input.minutesPer10 !== undefined ? { minutesPer10: input.minutesPer10 } : {}),
          ...(input.available !== undefined ? { available: input.available } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      if (input.ingredients) {
        await tx.productIngredient.deleteMany({ where: { productId: id } });
        await tx.productIngredient.createMany({
          data: input.ingredients.map((i) => ({
            organizationId: org.organizationId,
            productId: id,
            ingredientId: i.ingredientId,
            quantityPer10: i.quantityPer10 ?? null,
          })),
        });
      }
      const after = await this.find(tx, org, id);
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action:
          input.available !== undefined && Object.keys(input).length === 1
            ? 'product.availability_set'
            : 'product.update',
        entity: 'product',
        entityId: id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return this.present(after);
    });
  }

  /** PRD-3: an admin sees anyone's products; an employee sees only their own. */
  employeeProducts(user: AuthUser, org: OrgContext, employeeId: string) {
    const isSelf = employeeId === user.userId;
    if (!isSelf && org.actor !== 'org_admin' && org.actor !== 'bot') throw Errors.forbidden();
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.assertMember(tx, org, employeeId);
      return { items: await this.assignedTo(tx, org, employeeId), nextCursor: null };
    });
  }

  /** PRD-3: replaces the employee's assigned products. */
  setEmployeeProducts(
    user: AuthUser,
    org: OrgContext,
    employeeId: string,
    input: SetEmployeeProductsInput,
  ) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.assertMember(tx, org, employeeId);
      const wanted = [...new Set(input.productIds)];
      if (wanted.length > 0) {
        const found = await tx.product.findMany({
          where: { id: { in: wanted }, organizationId: org.organizationId, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== wanted.length) {
          const known = new Set(found.map((p) => p.id));
          throw Errors.validation({
            productIds: wanted
              .filter((p) => !known.has(p))
              .map((p) => `${p} is not a product here.`),
          });
        }
      }
      const before = await tx.employeeProduct.findMany({
        where: { employeeId, organizationId: org.organizationId },
        select: { productId: true },
      });
      await tx.employeeProduct.deleteMany({
        where: { employeeId, organizationId: org.organizationId },
      });
      if (wanted.length > 0) {
        await tx.employeeProduct.createMany({
          data: wanted.map((productId) => ({
            organizationId: org.organizationId,
            employeeId,
            productId,
          })),
        });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'employee.products_set',
        entity: 'user',
        entityId: employeeId,
        before: { productIds: before.map((b) => b.productId).sort() },
        after: { productIds: [...wanted].sort() },
      });
      return { items: await this.assignedTo(tx, org, employeeId), nextCursor: null };
    });
  }

  private async assignedTo(tx: Tx, org: OrgContext, employeeId: string) {
    const rows = await tx.product.findMany({
      where: {
        organizationId: org.organizationId,
        deletedAt: null,
        employeeProducts: { some: { employeeId } },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include,
    });
    return Promise.all(rows.map((r) => this.present(r)));
  }

  private async assertMember(tx: Tx, org: OrgContext, userId: string) {
    const member = await tx.membership.findFirst({
      where: { organizationId: org.organizationId, userId, status: 'active' },
      select: { id: true },
    });
    if (!member) throw Errors.notFound('Employee');
  }

  /** The picture must be one uploaded for this organization's products. */
  private async assertImage(org: OrgContext, key: string) {
    const parsed = parseKey(key);
    if (
      !parsed ||
      parsed.organizationId !== org.organizationId ||
      parsed.kind !== 'product' ||
      !(await this.storage.exists(key))
    ) {
      throw Errors.validation({ imageKey: ['Upload the picture first and send its imageKey.'] });
    }
  }

  private async assertIngredients(tx: Tx, org: OrgContext, list: { ingredientId: string }[]) {
    const ids = list.map((i) => i.ingredientId);
    const found = await tx.ingredient.findMany({
      where: { id: { in: ids }, organizationId: org.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== new Set(ids).size) {
      const known = new Set(found.map((i) => i.id));
      throw Errors.validation({
        ingredients: ids.filter((i) => !known.has(i)).map((i) => `${i} is not an ingredient here.`),
      });
    }
  }

  private async find(tx: Tx, org: OrgContext, id: string): Promise<Row> {
    const row = await tx.product.findFirst({
      where: { id, organizationId: org.organizationId, deletedAt: null },
      include,
    });
    if (!row) throw Errors.notFound('Product');
    return row;
  }

  private async present(row: Row) {
    return {
      id: row.id,
      name: row.name,
      imageKey: row.imageUrl,
      imageUrl: await this.storage.signedUrl(row.imageUrl),
      minutesPer10: row.minutesPer10,
      available: row.available,
      ingredients: row.ingredients.map((i) => ({
        id: i.ingredient.id,
        name: i.ingredient.name,
        quantityPer10: i.quantityPer10 === null ? null : Number(i.quantityPer10.toString()),
      })),
      version: row.version,
      createdAt: row.createdAt,
    };
  }
}

function snapshot(row: Row) {
  return {
    name: row.name,
    imageKey: row.imageUrl,
    minutesPer10: row.minutesPer10,
    available: row.available,
    ingredients: row.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      quantityPer10: i.quantityPer10 === null ? null : i.quantityPer10.toString(),
    })),
  };
}
