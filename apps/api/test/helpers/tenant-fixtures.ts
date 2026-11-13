import { asOwner, ownerDb } from './db';

export interface TenantFixture {
  bakeryId: string;
  contractorId: string;
  adminId: string;
  employeeId: string;
  contractorAdminId: string;
  productId: string;
  ingredientId: string;
  taskId: string;
  orderId: string;
  deliveryId: string;
}

let counter = 0;

/**
 * Creates a bakery and a linked contractor with at least one row in every org-scoped table,
 * so isolation tests have something to leak.
 */
export async function createTenantWithEveryTable(label: string): Promise<TenantFixture> {
  counter += 1;
  const tag = `${label.toLowerCase()}${counter}`;
  const db = ownerDb();
  const [admin, employee, contractorAdmin] = await Promise.all(
    ['admin', 'employee', 'buyer'].map((role) =>
      db.user.create({
        data: { name: `${label} ${role}`, email: `${role}.${tag}@test.local`, passwordHash: 'x' },
      }),
    ),
  );

  const bakery = await asOwner({ organizationId: null, userId: admin!.id }, (tx) =>
    tx.organization.create({
      data: { name: `${label} Bakery`, type: 'provider', createdById: admin!.id },
    }),
  );
  const contractor = await asOwner({ organizationId: null, userId: contractorAdmin!.id }, (tx) =>
    tx.organization.create({
      data: { name: `${label} Cafe`, type: 'contractor', createdById: contractorAdmin!.id },
    }),
  );

  const ids = await asOwner({ organizationId: bakery.id, userId: admin!.id }, async (tx) => {
    const org = { organizationId: bakery.id };
    await tx.membership.createMany({
      data: [
        { ...org, userId: admin!.id, role: 'admin', status: 'active' },
        { ...org, userId: employee!.id, role: 'employee', status: 'active' },
      ],
    });
    await tx.contractorLink.create({
      data: {
        ...org,
        contractorOrgId: contractor.id,
        status: 'approved',
        requestedById: contractorAdmin!.id,
      },
    });
    await tx.shift.create({
      data: {
        ...org,
        employeeId: employee!.id,
        weekday: 1,
        startTime: new Date('1970-01-01T06:00:00Z'),
        endTime: new Date('1970-01-01T14:00:00Z'),
      },
    });
    await tx.punchEvent.create({
      data: { ...org, employeeId: employee!.id, eventType: 'start', source: 'self' },
    });
    await tx.punchChangeRequest.create({
      data: { ...org, employeeId: employee!.id, shiftDate: new Date('2026-11-02') },
    });
    const product = await tx.product.create({
      data: { ...org, name: 'Bread', imageUrl: 'products/bread.jpg', minutesPer10: 12 },
    });
    const ingredient = await tx.ingredient.create({
      data: { ...org, name: 'Flour', source: 'Mill', packQuantity: 20, packUnit: 'kg' },
    });
    await tx.ingredientPrice.create({
      data: { ...org, ingredientId: ingredient.id, packPrice: 30_000, createdById: admin!.id },
    });
    await tx.productIngredient.create({
      data: { ...org, productId: product.id, ingredientId: ingredient.id },
    });
    await tx.employeeProduct.create({
      data: { ...org, employeeId: employee!.id, productId: product.id },
    });
    await tx.ingredientResponsibility.create({
      data: { ...org, ingredientId: ingredient.id, employeeId: employee!.id },
    });
    const task = await tx.task.create({
      data: { ...org, assigneeId: employee!.id, createdById: admin!.id, title: 'Clean ovens' },
    });
    await tx.taskPhoto.create({
      data: {
        ...org,
        taskId: task.id,
        fileUrl: 'photos/1.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      },
    });
    await tx.ingredientOrder.create({
      data: {
        ...org,
        ingredientId: ingredient.id,
        requestedById: employee!.id,
        quantity: 2,
        packPrice: 30_000,
        taskId: task.id,
      },
    });
    const team = await tx.team.create({ data: { ...org, ownerId: employee!.id, name: 'Team A' } });
    await tx.teamMember.create({ data: { ...org, teamId: team.id, employeeId: employee!.id } });
    await tx.outputEntry.create({
      data: {
        ...org,
        employeeId: employee!.id,
        workDate: new Date('2026-11-02'),
        productId: product.id,
        quantity: 30,
        teamId: team.id,
      },
    });
    await tx.dailyLog.create({
      data: {
        ...org,
        employeeId: employee!.id,
        workDate: new Date('2026-11-02'),
        cleaningHours: 1,
      },
    });
    await tx.notification.create({
      data: { ...org, userId: admin!.id, type: 'application.created' },
    });
    await tx.auditLog.create({
      data: {
        ...org,
        actorType: 'user',
        actorId: admin!.id,
        action: 'create',
        entity: 'product',
        entityId: product.id,
      },
    });
    const sale = { ...org, contractorOrgId: contractor.id };
    const order = await tx.order.create({
      data: { ...sale, deliveryDate: new Date('2026-11-02'), placedById: contractorAdmin!.id },
    });
    await tx.orderLine.create({
      data: {
        ...sale,
        orderId: order.id,
        productId: product.id,
        productName: 'Bread',
        quantity: 30,
      },
    });
    const delivery = await tx.delivery.create({
      data: { ...sale, orderId: order.id, deliveryDate: new Date('2026-11-02') },
    });
    await tx.deliveryLine.create({
      data: {
        ...sale,
        deliveryId: delivery.id,
        productId: product.id,
        productName: 'Bread',
        orderedQuantity: 30,
        deliveredQuantity: 20,
      },
    });
    await tx.deliveryChangeRequest.create({
      data: { ...sale, deliveryId: delivery.id, requestedById: contractorAdmin!.id, payload: {} },
    });
    return {
      productId: product.id,
      ingredientId: ingredient.id,
      taskId: task.id,
      orderId: order.id,
      deliveryId: delivery.id,
    };
  });

  await asOwner({ organizationId: contractor.id, userId: contractorAdmin!.id }, (tx) =>
    tx.membership.create({
      data: {
        organizationId: contractor.id,
        userId: contractorAdmin!.id,
        role: 'admin',
        status: 'active',
      },
    }),
  );

  return {
    bakeryId: bakery.id,
    contractorId: contractor.id,
    adminId: admin!.id,
    employeeId: employee!.id,
    contractorAdminId: contractorAdmin!.id,
    ...ids,
  };
}
