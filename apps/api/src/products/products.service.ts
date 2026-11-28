import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { type PackUnit, type Prisma } from '../generated/prisma/client';
import { batchCost, lineCost, sameKind } from './batch-cost';
import { CONTENT_TYPES, newKey, parseKey, sniffImage } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import {
  type CreateProductInput,
  type SetEmployeeProductsInput,
  type UpdateProductInput,
  type ProductOrderInput,
  type ProductTypeInput,
} from './products.schemas';

/** Product pictures: JPEG, PNG or WebP up to 5 MB, detected from the bytes. */
export const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;

const include = {
  ingredients: {
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          packQuantity: true,
          packUnit: true,
          wasteQuantity: true,
          // The price per pack in force now: prices take effect when saved, so the latest row
          // (decided 2026-11-12: append-only history).
          prices: {
            orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { packPrice: true },
          },
        },
      },
    },
    // Lines saved together share a time, so they are listed A to Z.
    orderBy: [{ ingredient: { name: 'asc' } }, { ingredientId: 'asc' }],
  },
  // F-001 FIN-1: the latest price row is the current price.
  prices: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 1 },
  type: { select: { id: true, name: true } },
} satisfies Prisma.ProductInclude;

/** Decided 2026-11-30: the custom order first; A to Z for products not placed yet. */
const ORDER = [
  { sortOrder: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductOrderByWithRelationInput[];

type Row = Prisma.ProductGetPayload<{ include: typeof include }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /**
   * A plain light-blue picture for products the AI bot adds (it cannot take photos); the admin
   * replaces it from Products.
   */
  async placeholderImage(org: OrgContext): Promise<string> {
    const key = newKey(org.organizationId, 'product', 'png');
    await this.storage.put(key, Buffer.from(PLACEHOLDER_PNG, 'base64'), CONTENT_TYPES.png);
    return key;
  }

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
        orderBy: ORDER,
        include,
      });
      const costs = orgCan(org, 'prices.manage');
      return {
        items: await Promise.all(rows.map((r) => this.present(r, true, costs))),
        nextCursor: null,
      };
    });
  }

  get(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) =>
      this.present(await this.find(tx, org, id), true, orgCan(org, 'prices.manage')),
    );
  }

  create(user: AuthUser, org: OrgContext, input: CreateProductInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      if (input.unitPrice !== undefined && !orgCan(org, 'prices.manage')) throw Errors.forbidden();
      if (input.imageKey !== undefined) await this.assertImage(org, input.imageKey);
      const lines = await this.ingredientLines(tx, org, input.ingredients, []);
      const imageKey = input.imageKey ?? (await this.placeholderImage(org));
      if (input.typeId) await this.assertType(tx, org, input.typeId);
      // A new product goes to the end of the custom order.
      const last = await tx.product.aggregate({
        where: { organizationId: org.organizationId },
        _max: { sortOrder: true },
      });
      const product = await tx.product.create({
        data: {
          organizationId: org.organizationId,
          name: input.name,
          typeId: input.typeId ?? null,
          sortOrder: (last._max.sortOrder ?? 0) + 1,
          imageUrl: imageKey,
          minutesPer10: input.minutesPer10,
          batchYield: input.batchYield ?? null,
          available: input.available,
          // organization_id comes from the product through the composite key.
          ingredients: { create: lines },
        },
        include,
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'product.create',
        entity: 'product',
        entityId: product.id,
        after: snapshot(product),
      });
      const costs = orgCan(org, 'prices.manage');
      if (input.unitPrice === undefined) return this.present(product, true, costs);
      await tx.productPrice.create({
        data: {
          organizationId: org.organizationId,
          productId: product.id,
          unitPrice: input.unitPrice,
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'product.price',
        entity: 'product',
        entityId: product.id,
        before: { unitPrice: null },
        after: { unitPrice: input.unitPrice },
      });
      return this.present(await this.find(tx, org, product.id), true, costs);
    });
  }

  update(user: AuthUser, org: OrgContext, id: string, version: number, input: UpdateProductInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.find(tx, org, id);
      if (before.version !== version) throw Errors.versionConflict();
      if (input.imageKey !== undefined) await this.assertImage(org, input.imageKey);
      const lines = input.ingredients
        ? await this.ingredientLines(tx, org, input.ingredients, before.ingredients)
        : null;
      if (input.typeId) await this.assertType(tx, org, input.typeId);
      const result = await tx.product.updateMany({
        where: { id, version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.typeId !== undefined ? { typeId: input.typeId } : {}),
          ...(input.imageKey !== undefined ? { imageUrl: input.imageKey } : {}),
          ...(input.minutesPer10 !== undefined ? { minutesPer10: input.minutesPer10 } : {}),
          ...(input.batchYield !== undefined ? { batchYield: input.batchYield } : {}),
          ...(input.available !== undefined ? { available: input.available } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      if (lines) {
        await tx.productIngredient.deleteMany({ where: { productId: id } });
        await tx.productIngredient.createMany({
          data: lines.map((l) => ({ organizationId: org.organizationId, productId: id, ...l })),
        });
      }
      const after = await this.find(tx, org, id);
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action:
          input.available !== undefined && Object.keys(input).length === 1
            ? 'product.availability_set'
            : 'product.update',
        entity: 'product',
        entityId: id,
        before: snapshot(before),
        after: snapshot(after),
      });
      return this.present(after, true, orgCan(org, 'prices.manage'));
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
        actor: actorFor(user),
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
      orderBy: ORDER,
      include,
    });
    return Promise.all(rows.map((r) => this.present(r, orgCan(org, 'finance.view'))));
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

  /**
   * Checks the ingredients belong here and turns the request into rows. Decided 2026-12-01: the
   * amount is per batch, in the ingredient's pack unit unless another of the same kind is given;
   * an item without `quantity` keeps the amount already saved for that ingredient.
   */
  private async ingredientLines(
    tx: Tx,
    org: OrgContext,
    list: { ingredientId: string; quantity?: number | null; unit?: PackUnit }[],
    current: {
      ingredientId: string;
      batchQuantity: Prisma.Decimal | null;
      batchUnit: PackUnit | null;
    }[],
  ) {
    const ids = list.map((i) => i.ingredientId);
    const found = await tx.ingredient.findMany({
      where: { id: { in: ids }, organizationId: org.organizationId, deletedAt: null },
      select: { id: true, name: true, packUnit: true },
    });
    if (found.length !== new Set(ids).size) {
      const known = new Set(found.map((i) => i.id));
      throw Errors.validation({
        ingredients: ids.filter((i) => !known.has(i)).map((i) => `${i} is not an ingredient here.`),
      });
    }
    const byId = new Map(found.map((i) => [i.id, i]));
    const saved = new Map(current.map((c) => [c.ingredientId, c]));
    const wrong: string[] = [];
    const lines = list.map((i) => {
      const ingredient = byId.get(i.ingredientId)!;
      if (i.quantity === undefined) {
        const keep = saved.get(i.ingredientId);
        return {
          ingredientId: i.ingredientId,
          batchQuantity: keep?.batchQuantity ?? null,
          batchUnit: keep?.batchUnit ?? null,
        };
      }
      if (i.quantity === null) {
        return { ingredientId: i.ingredientId, batchQuantity: null, batchUnit: null };
      }
      const unit = i.unit ?? ingredient.packUnit;
      if (!sameKind(unit, ingredient.packUnit)) {
        wrong.push(`${ingredient.name} is counted in ${ingredient.packUnit}; use a matching unit.`);
      }
      return { ingredientId: i.ingredientId, batchQuantity: i.quantity, batchUnit: unit };
    });
    if (wrong.length) throw Errors.validation({ ingredients: wrong });
    return lines;
  }

  private async find(tx: Tx, org: OrgContext, id: string): Promise<Row> {
    const row = await tx.product.findFirst({
      where: { id, organizationId: org.organizationId, deletedAt: null },
      include,
    });
    if (!row) throw Errors.notFound('Product');
    return row;
  }

  // ---------------------------------------------------- types and custom order (2026-11-30)

  listTypes(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => ({
      items: await tx.productType.findMany({
        where: { organizationId: org.organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
      nextCursor: null,
    }));
  }

  /** Creates a type; the same name again returns the existing one. Audited. */
  createType(user: AuthUser, org: OrgContext, input: ProductTypeInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const existing = await tx.productType.findFirst({
        where: {
          organizationId: org.organizationId,
          name: { equals: input.name, mode: 'insensitive' },
        },
        select: { id: true, name: true },
      });
      if (existing) return existing;
      const type = await tx.productType.create({
        data: { organizationId: org.organizationId, name: input.name },
        select: { id: true, name: true },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'product_type.create',
        entity: 'product_type',
        entityId: type.id,
        after: type,
      });
      return type;
    });
  }

  renameType(user: AuthUser, org: OrgContext, id: string, input: ProductTypeInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.assertType(tx, org, id);
      const clash = await tx.productType.findFirst({
        where: {
          organizationId: org.organizationId,
          name: { equals: input.name, mode: 'insensitive' },
          NOT: { id },
        },
      });
      if (clash) throw Errors.conflict('TYPE_EXISTS', 'Another type has this name.');
      const after = await tx.productType.update({
        where: { id },
        data: { name: input.name },
        select: { id: true, name: true },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'product_type.rename',
        entity: 'product_type',
        entityId: id,
        before,
        after,
      });
      return after;
    });
  }

  /**
   * Saves the custom order: the given products in this order, first first. Products left out keep
   * their relative order after them. Audited.
   */
  setOrder(user: AuthUser, org: OrgContext, input: ProductOrderInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const all = await tx.product.findMany({
        where: { organizationId: org.organizationId, deletedAt: null },
        orderBy: ORDER,
        select: { id: true },
      });
      const known = new Set(all.map((p) => p.id));
      const unknown = input.productIds.filter((id) => !known.has(id));
      if (unknown.length) {
        throw Errors.validation({ productIds: [`Not products here: ${unknown.join(', ')}.`] });
      }
      const listed = [...new Set(input.productIds)];
      const order = [...listed, ...all.map((p) => p.id).filter((id) => !listed.includes(id))];
      for (const [i, id] of order.entries()) {
        await tx.product.update({ where: { id }, data: { sortOrder: i + 1 } });
      }
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'product.reorder',
        entity: 'organization',
        entityId: org.organizationId,
        before: { productIds: all.map((p) => p.id) },
        after: { productIds: order },
      });
      return { productIds: order };
    });
  }

  private async assertType(tx: Tx, org: OrgContext, id: string) {
    const type = await tx.productType.findFirst({
      where: { id, organizationId: org.organizationId },
      select: { id: true, name: true },
    });
    if (!type) throw Errors.validation({ typeId: ['Not a product type here.'] });
    return type;
  }

  /**
   * `costs` (admins with prices.manage): each ingredient line's cost and the batch's cost at
   * today's ingredient prices (decided 2026-12-01).
   */
  private async present(row: Row, showPrice = true, costs = false) {
    const lineCosts = row.ingredients.map((i) =>
      lineCost(
        i.batchQuantity === null ? null : Number(i.batchQuantity.toString()),
        i.batchUnit,
        // Decided 2026-11-28: the usable part of the pack (minus what is thrown away).
        Number(i.ingredient.packQuantity.toString()) -
          Number(i.ingredient.wasteQuantity.toString()),
        i.ingredient.packUnit,
        i.ingredient.prices[0]?.packPrice ?? null,
      ),
    );
    return {
      id: row.id,
      name: row.name,
      imageKey: row.imageUrl,
      imageUrl: await this.storage.signedUrl(row.imageUrl),
      minutesPer10: row.minutesPer10,
      available: row.available,
      type: row.type,
      sortOrder: row.sortOrder,
      batchYield: row.batchYield,
      ingredients: row.ingredients.map((i, n) => ({
        id: i.ingredient.id,
        name: i.ingredient.name,
        quantity: i.batchQuantity === null ? null : Number(i.batchQuantity.toString()),
        unit: i.batchUnit,
        packUnit: i.ingredient.packUnit,
        ...(costs ? { cost: lineCosts[n] === null ? null : Math.round(lineCosts[n]!) } : {}),
      })),
      ...(costs ? { cost: batchCost(lineCosts, row.batchYield) } : {}),
      ...(showPrice ? { unitPrice: row.prices[0]?.unitPrice ?? null } : {}),
      version: row.version,
      createdAt: row.createdAt,
    };
  }

  /** F-001 FIN-1, FIN-5: a new price applies from now on; past deliveries keep theirs. Audited. */
  setPrice(user: AuthUser, org: OrgContext, id: string, unitPrice: number) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.find(tx, org, id);
      const row = await tx.productPrice.create({
        data: {
          organizationId: org.organizationId,
          productId: id,
          unitPrice,
          createdById: user.userId,
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'product.price',
        entity: 'product',
        entityId: id,
        before: { unitPrice: before.prices[0]?.unitPrice ?? null },
        after: { unitPrice, effectiveFrom: row.effectiveFrom },
      });
      return this.present(await this.find(tx, org, id), true, true);
    });
  }

  prices(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      await this.find(tx, org, id);
      const rows = await tx.productPrice.findMany({
        where: { productId: id, organizationId: org.organizationId },
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          unitPrice: r.unitPrice,
          effectiveFrom: r.effectiveFrom,
          createdById: r.createdById,
        })),
        nextCursor: null,
      };
    });
  }
}

function snapshot(row: Row) {
  return {
    name: row.name,
    imageKey: row.imageUrl,
    minutesPer10: row.minutesPer10,
    available: row.available,
    batchYield: row.batchYield,
    ingredients: row.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      batchQuantity: i.batchQuantity === null ? null : i.batchQuantity.toString(),
      batchUnit: i.batchUnit,
    })),
  };
}

/** 64 x 64 light brand blue, used until a real picture is uploaded. */
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAT0lEQVR42u3PMQ0AAAgDsPmXysXNhQRukiY10FTPaxEQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQuCwqyUKkAOW7iwAAAABJRU5ErkJggg==';
