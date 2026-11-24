import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { orgCan } from '../common/request-context';
import { addDays, isoDate } from '../common/time';
import { DueNextService } from '../deliveries/due-next.service';
import { FinanceService } from '../finance/finance.service';
import { IngredientsService } from '../ingredients/ingredients.service';
import { OrdersService } from '../orders/orders.service';
import { type Capability } from '../permissions/permissions';
import { ProductsService } from '../products/products.service';
import { ShiftsService } from '../shifts/shifts.service';
import { IngredientOrdersService } from '../tasks/ingredient-orders.service';
import { RecurringTasksService } from '../tasks/recurring-tasks.service';
import { TasksService } from '../tasks/tasks.service';
import { type LlmTool } from './llm/types';
import { type BotCtx, type Preview, ToolInputError } from './tool-types';

/**
 * The rest of what the admin can do, for the bot (decided 2026-11-13: the bot does everything the
 * admin can, except widen its own powers). Each one is a proposal with a preview, applied only on
 * Confirm through the same service and permission check as the admin's own screen. None deletes.
 */
const uuid = z.uuid();

const taskInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  assignee_id: uuid.optional().describe('One employee'),
  assignee_ids: z.array(uuid).min(1).max(200).optional().describe('Several employees'),
  for_all: z.boolean().optional().describe('Every employee, including people who join later'),
  due_date: isoDate,
});
const orderInput = z.strictObject({
  order_id: uuid,
  lines: z
    .array(z.strictObject({ product_id: uuid, quantity: z.number().int().min(1).max(100_000) }))
    .max(200)
    .describe(
      'The whole new list; products left out are removed. An empty list cancels the order.',
    ),
});
const changeInput = z.strictObject({ item_id: uuid, decision: z.enum(['accept', 'reject']) });
const punchInput = z.strictObject({ request_id: uuid, decision: z.enum(['approve', 'reject']) });
const employeeProductsInput = z.strictObject({
  employee_id: uuid,
  product_ids: z.array(uuid).max(500).optional(),
  product_names: z.array(z.string().min(1).max(120)).max(500).optional(),
});
const responsibleInput = z.strictObject({
  ingredient_id: uuid,
  employee_ids: z.array(uuid).max(200).describe('The whole new list of responsible employees'),
});
const ingredientOrderInput = z.strictObject({ order_id: uuid, step: z.enum(['fulfil', 'check']) });
const madeInput = z.strictObject({
  product_id: uuid,
  contractor_id: uuid.optional().describe('Leave out for every contractor'),
  made: z.boolean(),
});

// Phase 3.
const recurringInput = z.strictObject({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  assignee_id: uuid,
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .optional()
    .describe('For weekly: 0 = Sunday … 6 = Saturday'),
  day_of_month: z
    .number()
    .int()
    .min(1)
    .max(31)
    .optional()
    .describe('For monthly; 31 means the last day of shorter months'),
  start_date: isoDate,
  end_date: isoDate.optional(),
});
const recurringChangeInput = z.strictObject({
  recurring_task_id: uuid,
  active: z.boolean().optional().describe('false pauses, true resumes'),
  end_date: isoDate.nullable().optional().describe('Last day it makes a task; null for no end'),
});
const priceInput = z.strictObject({
  product_id: uuid,
  unit_price: z.number().int().min(0).max(100_000_000).describe('Whole won per piece'),
});
const paymentInput = z.strictObject({
  payment_id: uuid,
  decision: z.enum(['approve', 'reject']),
  approved_amount: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Whole won; leave out to approve the amount the contractor submitted'),
  payment_date: isoDate.optional().describe('Leave out for today'),
  reason: z.string().trim().min(1).max(500).optional().describe('Needed to reject'),
});

function schemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const def = (name: string, description: string, schema: z.ZodType): LlmTool => ({
  name,
  description: `${description} Nothing changes until the admin confirms.`,
  inputSchema: schemaOf(schema),
});

export const MORE_TOOLS: Record<string, { schema: z.ZodType; def: LlmTool; caps: Capability[] }> = {
  create_task: {
    schema: taskInput,
    caps: ['tasks.manage'],
    def: def(
      'create_task',
      'Propose a task for an employee (TSK-1); it is done with a camera photo.',
      taskInput,
    ),
  },
  correct_order: {
    schema: orderInput,
    caps: ['orders.edit'],
    def: def(
      'correct_order',
      "Propose correcting a contractor's order (ORD-4); the contractor is told.",
      orderInput,
    ),
  },
  decide_order_change: {
    schema: changeInput,
    caps: [],
    def: def(
      'decide_order_change',
      "Propose accepting or rejecting one product in a contractor's change request (see search_data order_change_requests).",
      changeInput,
    ),
  },
  decide_punch_correction: {
    schema: punchInput,
    caps: ['punch.edit'],
    def: def(
      'decide_punch_correction',
      "Propose approving or rejecting an employee's shift correction request (see search_data punch_change_requests).",
      punchInput,
    ),
  },
  set_employee_products: {
    schema: employeeProductsInput,
    caps: ['products.manage'],
    def: def(
      'set_employee_products',
      'Propose the whole list of products an employee logs output for (PRD-3), by id or name.',
      employeeProductsInput,
    ),
  },
  set_ingredient_responsible: {
    schema: responsibleInput,
    caps: ['ingredients.assignResponsibility'],
    def: def(
      'set_ingredient_responsible',
      'Propose who orders an ingredient (ING-4).',
      responsibleInput,
    ),
  },
  advance_ingredient_order: {
    schema: ingredientOrderInput,
    caps: ['ingredients.fulfil'],
    def: def(
      'advance_ingredient_order',
      'Propose marking an ingredient order bought (fulfil) or arrived and checked (check) (ING-6).',
      ingredientOrderInput,
    ),
  },
  create_recurring_task: {
    schema: recurringInput,
    caps: ['tasks.manage'],
    def: def(
      'create_recurring_task',
      'Propose a repeating task: one ordinary task for the employee every day, every week on chosen weekdays, or every month on a day, from start_date.',
      recurringInput,
    ),
  },
  change_recurring_task: {
    schema: recurringChangeInput,
    caps: ['tasks.manage'],
    def: def(
      'change_recurring_task',
      'Propose pausing, resuming or ending a repeating task (see search_data repeating_tasks). Tasks already made stay.',
      recurringChangeInput,
    ),
  },
  set_product_price: {
    schema: priceInput,
    caps: ['prices.manage'],
    def: def(
      'set_product_price',
      'Propose a new unit price for a product. It applies to deliveries completed from now on; earlier deliveries keep their price.',
      priceInput,
    ),
  },
  decide_payment: {
    schema: paymentInput,
    caps: ['payments.review'],
    def: def(
      'decide_payment',
      "Propose approving a contractor's pending payment (allocated to their oldest unpaid deliveries first) or rejecting it with a reason (see search_data payments).",
      paymentInput,
    ),
  },
  mark_made: {
    schema: madeInput,
    caps: ['orders.markMade'],
    def: def(
      'mark_made',
      'Propose ticking a product as made (or not) in the orders due next.',
      madeInput,
    ),
  },
};

const lineText = (name: string, q: number) => `${name} ${q}`;

@Injectable()
export class MoreBotTools {
  constructor(
    private readonly tasks: TasksService,
    private readonly orders: OrdersService,
    private readonly shifts: ShiftsService,
    private readonly products: ProductsService,
    private readonly ingredients: IngredientsService,
    private readonly ingredientOrders: IngredientOrdersService,
    private readonly dueNext: DueNextService,
    private readonly recurring: RecurringTasksService,
    private readonly finance: FinanceService,
  ) {}

  private async pendingPayment(ctx: BotCtx, id: string) {
    const list = (await this.finance.listPayments(ctx.user, ctx.org, { status: 'pending' }))
      .items as {
      id: string;
      submittedAmount: number;
      contractor: { id: string; name: string } | null;
    }[];
    const p = list.find((x) => x.id === id);
    if (!p) throw new ToolInputError('No pending payment with that id.');
    return p;
  }

  /** Rule 4 of F-001: the approved amount goes to the oldest deliveries with something left. */
  private async oldestFirst(ctx: BotCtx, contractorId: string, amount: number) {
    const today = await this.finance.todayFor(ctx.user, ctx.org);
    const list = (
      await this.finance.deliveries(ctx.user, ctx.org, {
        contractor_id: contractorId,
        from: addDays(today, -369),
        to: addDays(today, 30),
      })
    ).items as { id: string; deliveryDate: string; remainingValue: number }[];
    let left = amount;
    const allocations: { deliveryId: string; amount: number; date: string }[] = [];
    for (const d of [...list]
      .filter((x) => x.remainingValue > 0)
      .sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))) {
      if (left <= 0) break;
      const take = Math.min(left, d.remainingValue);
      allocations.push({ deliveryId: d.id, amount: take, date: d.deliveryDate });
      left -= take;
    }
    if (left > 0) {
      throw new ToolInputError(
        `Only ${amount - left} won is left to pay on this contractor's deliveries; approve at most that.`,
      );
    }
    return { allocations, today };
  }

  private async employeeName(ctx: BotCtx, id: string): Promise<string> {
    const plans = (await this.shifts.listPlans(ctx.user, ctx.org)).items;
    const hit = plans.find((p) => p.employee.id === id);
    if (!hit) throw new ToolInputError(`No active member ${id} in this organization.`);
    return hit.employee.name;
  }

  async preview(
    ctx: BotCtx,
    name: string,
    raw: unknown,
  ): Promise<{ preview: Preview; input: unknown }> {
    const one = (
      summary: string,
      label: string,
      before: unknown,
      after: unknown,
      input: unknown = raw,
      rows = 1,
    ) => ({
      input,
      preview: { summary, rows, changes: [{ label, before, after }] },
    });
    switch (name) {
      case 'create_task': {
        const t = raw as z.infer<typeof taskInput>;
        const given = [t.assignee_id, t.assignee_ids, t.for_all ? true : undefined].filter(
          (x) => x !== undefined,
        );
        if (given.length !== 1)
          throw new ToolInputError('Give exactly one of assignee_id, assignee_ids or for_all.');
        const ids = t.assignee_ids ?? (t.assignee_id ? [t.assignee_id] : []);
        const names = await Promise.all(ids.map((id) => this.employeeName(ctx, id)));
        const who = t.for_all ? 'every employee' : names.join(', ');
        return one(`New task for ${who}`, t.title, null, {
          for: who,
          due: t.due_date,
          details: t.description ?? '',
        });
      }
      case 'correct_order': {
        const o = raw as z.infer<typeof orderInput>;
        const order = await this.orders.get(ctx.user, ctx.org, o.order_id).catch(() => {
          throw new ToolInputError('No order with that id in this organization.');
        });
        if (order.status !== 'placed') throw new ToolInputError('That order is cancelled.');
        const products = (await this.products.list(ctx.user, ctx.org)).items;
        const nameOf = (id: string) =>
          order.lines.find((l) => l.productId === id)?.productName ??
          products.find((p) => p.id === id)?.name;
        for (const l of o.lines) {
          if (!nameOf(l.product_id))
            throw new ToolInputError(`No product ${l.product_id} in this organization.`);
        }
        const before =
          order.lines.map((l) => lineText(l.productName, l.quantity)).join(', ') || 'nothing';
        const after = o.lines.length
          ? o.lines.map((l) => lineText(nameOf(l.product_id)!, l.quantity)).join(', ')
          : 'order cancelled';
        return one(
          `Correct ${order.contractor.name}'s order for ${order.deliveryDate}`,
          order.contractor.name,
          before,
          after,
          { ...o, _version: order.version },
          Math.max(1, o.lines.length),
        );
      }
      case 'decide_order_change': {
        const c = raw as z.infer<typeof changeInput>;
        const open = (await this.orders.listChangeRequests(ctx.user, ctx.org, 'open')).items as {
          contractor: { name: string };
          deliveryDate: string;
          items: {
            id: string;
            productName: string;
            fromQuantity: number;
            toQuantity: number;
            status: string;
            needsAdmin: boolean;
          }[];
        }[];
        for (const r of open) {
          const item = r.items.find((i) => i.id === c.item_id && i.status === 'pending');
          if (!item) continue;
          if (item.needsAdmin && !orgCan(ctx.org, 'orders.edit')) {
            throw new ToolInputError(
              'Smaller quantities and removals need the admin (orders.edit).',
            );
          }
          return one(
            `${c.decision === 'accept' ? 'Accept' : 'Reject'} ${r.contractor.name}'s change for ${r.deliveryDate}`,
            item.productName,
            item.fromQuantity,
            c.decision === 'accept' ? item.toQuantity : `${item.fromQuantity} (change rejected)`,
          );
        }
        throw new ToolInputError('No pending order change item with that id.');
      }
      case 'decide_punch_correction': {
        const p = raw as z.infer<typeof punchInput>;
        const pending = (await this.shifts.listRequests(ctx.user, ctx.org, 'pending')).items;
        const r = pending.find((x) => x.id === p.request_id);
        if (!r) throw new ToolInputError('No pending shift correction with that id.');
        const t = (d: Date | null) => (d ? new Date(d).toISOString().slice(11, 16) + ' UTC' : '?');
        return one(
          `${p.decision === 'approve' ? 'Approve' : 'Reject'} ${r.employee?.name ?? 'employee'}'s correction for ${r.shiftDate}`,
          r.employee?.name ?? 'Employee',
          `${t(r.original.start)}-${t(r.original.end)}`,
          p.decision === 'approve' ? `${t(r.requested.start)}-${t(r.requested.end)}` : 'unchanged',
        );
      }
      case 'set_employee_products': {
        const e = raw as z.infer<typeof employeeProductsInput>;
        const who = await this.employeeName(ctx, e.employee_id);
        const all = (await this.products.list(ctx.user, ctx.org)).items;
        const ids = new Set(e.product_ids ?? []);
        for (const n of e.product_names ?? []) {
          const hit = all.find((p) => p.name.toLowerCase() === n.trim().toLowerCase());
          if (!hit) throw new ToolInputError(`No product named "${n}".`);
          ids.add(hit.id);
        }
        for (const id of ids)
          if (!all.some((p) => p.id === id)) throw new ToolInputError(`No product ${id}.`);
        const current = (await this.products.employeeProducts(ctx.user, ctx.org, e.employee_id))
          .items;
        const names = (list: string[]) =>
          list
            .map((id) => all.find((p) => p.id === id)?.name ?? id)
            .sort()
            .join(', ') || 'none';
        return one(`Products ${who} logs`, who, names(current.map((p) => p.id)), names([...ids]), {
          employee_id: e.employee_id,
          _productIds: [...ids],
        });
      }
      case 'set_ingredient_responsible': {
        const r = raw as z.infer<typeof responsibleInput>;
        const ing = await this.ingredients.get(ctx.user, ctx.org, r.ingredient_id).catch(() => {
          throw new ToolInputError('No ingredient with that id in this organization.');
        });
        const names = await Promise.all(r.employee_ids.map((id) => this.employeeName(ctx, id)));
        return one(
          `Who orders ${ing.name}`,
          ing.name,
          ing.responsibleEmployees.map((p) => p.name).join(', ') || 'nobody',
          names.join(', ') || 'nobody',
        );
      }
      case 'advance_ingredient_order': {
        const a = raw as z.infer<typeof ingredientOrderInput>;
        const list = (await this.ingredientOrders.list(ctx.user, ctx.org)).items as {
          id: string;
          status: string;
          quantity: number;
          ingredient: { name: string };
        }[];
        const o = list.find((x) => x.id === a.order_id);
        if (!o) throw new ToolInputError('No ingredient order with that id.');
        const next = a.step === 'fulfil' ? 'fulfilled' : 'checked';
        if (
          (a.step === 'fulfil' && o.status !== 'requested') ||
          (a.step === 'check' && o.status !== 'fulfilled')
        ) {
          throw new ToolInputError(`That order is ${o.status}; it cannot be ${next} now.`);
        }
        return one(`${o.ingredient.name} × ${o.quantity} packs`, o.ingredient.name, o.status, next);
      }
      case 'create_recurring_task': {
        const r = raw as z.infer<typeof recurringInput>;
        const who = await this.employeeName(ctx, r.assignee_id);
        if (r.frequency === 'weekly' && !r.weekdays?.length)
          throw new ToolInputError('Give weekdays for a weekly task.');
        if (r.frequency === 'monthly' && !r.day_of_month)
          throw new ToolInputError('Give day_of_month for a monthly task.');
        const when =
          r.frequency === 'daily'
            ? 'every day'
            : r.frequency === 'weekly'
              ? `every ${r.weekdays!.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`
              : `every month on day ${r.day_of_month}`;
        return one(`Repeating task for ${who}`, r.title, null, {
          for: who,
          repeats: when,
          from: r.start_date,
          until: r.end_date ?? 'no end',
        });
      }
      case 'change_recurring_task': {
        const c = raw as z.infer<typeof recurringChangeInput>;
        if (c.active === undefined && c.end_date === undefined)
          throw new ToolInputError('Give active or end_date.');
        const rules = (await this.recurring.list(ctx.user, ctx.org)).items;
        const r = rules.find((x) => x.id === c.recurring_task_id);
        if (!r) throw new ToolInputError('No repeating task with that id.');
        return one(
          `Change the repeating task "${r.title}"`,
          r.title,
          { on: r.active, until: r.endDate ?? 'no end' },
          {
            on: c.active ?? r.active,
            until: c.end_date === undefined ? (r.endDate ?? 'no end') : (c.end_date ?? 'no end'),
          },
          { ...c, _version: r.version },
        );
      }
      case 'set_product_price': {
        const p = raw as z.infer<typeof priceInput>;
        const product = (await this.products.list(ctx.user, ctx.org)).items.find(
          (x) => x.id === p.product_id,
        ) as { name: string; unitPrice?: number | null } | undefined;
        if (!product) throw new ToolInputError('No product with that id in this organization.');
        return one(
          `New price for ${product.name}`,
          product.name,
          product.unitPrice == null ? 'no price' : `${product.unitPrice} won`,
          `${p.unit_price} won`,
        );
      }
      case 'decide_payment': {
        const d = raw as z.infer<typeof paymentInput>;
        const pay = await this.pendingPayment(ctx, d.payment_id);
        const who = pay.contractor?.name ?? 'Contractor';
        if (d.decision === 'reject') {
          if (!d.reason) throw new ToolInputError('Give a reason to reject.');
          return one(`Reject ${who}'s payment`, who, `${pay.submittedAmount} won pending`, {
            rejected: d.reason,
          });
        }
        const amount = d.approved_amount ?? pay.submittedAmount;
        const { allocations, today } = await this.oldestFirst(ctx, pay.contractor!.id, amount);
        const paymentDate = d.payment_date ?? today;
        return {
          input: {
            payment_id: d.payment_id,
            decision: 'approve',
            _approve: {
              approvedAmount: amount,
              paymentDate,
              allocations: allocations.map((a) => ({ deliveryId: a.deliveryId, amount: a.amount })),
            },
          },
          preview: {
            summary: `Approve ${amount} won from ${who}${amount !== pay.submittedAmount ? ` (submitted ${pay.submittedAmount})` : ''}, paid ${paymentDate}`,
            rows: allocations.length,
            changes: allocations.map((a) => ({
              label: `Delivery ${a.date}`,
              before: 'unpaid part',
              after: `${a.amount} won paid`,
            })),
          },
        };
      }
      case 'mark_made': {
        const m = raw as z.infer<typeof madeInput>;
        const due = await this.dueNext.dueNext(ctx.user, ctx.org, m.contractor_id);
        const total = due.totals.find((t) => t.productId === m.product_id);
        if (!total) throw new ToolInputError('That product is not in the orders due next.');
        return one(
          `${m.made ? 'Tick' : 'Untick'} ${total.productName} as made`,
          total.productName,
          `${total.madeQuantity} of ${total.quantity} made`,
          m.made ? `${total.quantity} of ${total.quantity} made` : 'not made',
        );
      }
    }
    throw new ToolInputError(`${name} is not a write tool.`);
  }

  async apply(ctx: BotCtx, name: string, input: unknown): Promise<unknown> {
    const { user, org } = ctx;
    switch (name) {
      case 'create_task': {
        const t = input as z.infer<typeof taskInput>;
        return this.tasks.create(user, org, {
          title: t.title,
          ...(t.for_all
            ? { forAll: true }
            : { assigneeIds: t.assignee_ids ?? (t.assignee_id ? [t.assignee_id] : []) }),
          dueDate: t.due_date,
          ...(t.description ? { description: t.description } : {}),
        });
      }
      case 'correct_order': {
        const o = input as z.infer<typeof orderInput> & { _version: number };
        return this.orders.setLines(user, org, o.order_id, o._version, {
          lines: o.lines.map((l) => ({ productId: l.product_id, quantity: l.quantity })),
        });
      }
      case 'decide_order_change': {
        const c = input as z.infer<typeof changeInput>;
        return this.orders.decideItem(user, org, c.item_id, c.decision === 'accept');
      }
      case 'decide_punch_correction': {
        const p = input as z.infer<typeof punchInput>;
        return this.shifts.decide(user, org, p.request_id, { decision: p.decision });
      }
      case 'set_employee_products': {
        const e = input as { employee_id: string; _productIds: string[] };
        return this.products.setEmployeeProducts(user, org, e.employee_id, {
          productIds: e._productIds,
        });
      }
      case 'set_ingredient_responsible': {
        const r = input as z.infer<typeof responsibleInput>;
        return this.ingredients.setResponsible(user, org, r.ingredient_id, {
          employeeIds: r.employee_ids,
        });
      }
      case 'advance_ingredient_order': {
        const a = input as z.infer<typeof ingredientOrderInput>;
        return this.ingredientOrders.advance(user, org, a.order_id, a.step);
      }
      case 'create_recurring_task': {
        const r = input as z.infer<typeof recurringInput>;
        return this.recurring.create(user, org, {
          title: r.title,
          assigneeId: r.assignee_id,
          frequency: r.frequency,
          startDate: r.start_date,
          ...(r.description ? { description: r.description } : {}),
          ...(r.weekdays ? { weekdays: r.weekdays } : {}),
          ...(r.day_of_month ? { dayOfMonth: r.day_of_month } : {}),
          ...(r.end_date ? { endDate: r.end_date } : {}),
        });
      }
      case 'change_recurring_task': {
        const c = input as z.infer<typeof recurringChangeInput> & { _version: number };
        return this.recurring.update(user, org, c.recurring_task_id, c._version, {
          ...(c.active !== undefined ? { active: c.active } : {}),
          ...(c.end_date !== undefined ? { endDate: c.end_date } : {}),
        });
      }
      case 'set_product_price': {
        const p = input as z.infer<typeof priceInput>;
        return this.products.setPrice(user, org, p.product_id, p.unit_price);
      }
      case 'decide_payment': {
        const d = input as z.infer<typeof paymentInput> & {
          _approve?: {
            approvedAmount: number;
            paymentDate: string;
            allocations: { deliveryId: string; amount: number }[];
          };
        };
        if (d.decision === 'reject') return this.finance.reject(user, org, d.payment_id, d.reason!);
        return this.finance.approve(user, org, d.payment_id, d._approve!);
      }
      case 'mark_made': {
        const m = input as z.infer<typeof madeInput>;
        return this.dueNext.markMade(user, org, {
          productId: m.product_id,
          made: m.made,
          ...(m.contractor_id ? { contractorId: m.contractor_id } : {}),
        });
      }
    }
    throw new ToolInputError(`${name} is not a write tool.`);
  }
}
