import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import {
  activeMembers,
  assertNotInOrganization,
  createMembershipOnce,
} from '../common/memberships';
import { pageArgs, toPage } from '../common/pagination';
import { type AuthUser, type OrgContext, dbContext } from '../common/request-context';
import { StorageService } from '../storage/storage.service';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import {
  type CreateMemberInput,
  type ListMembersInput,
  type HandOverInput,
  type UpdateMemberInput,
} from './members.schemas';

const userFields = { id: true, name: true, email: true, avatarKey: true } as const;

type MemberRow = {
  id: string;
  role: 'admin' | 'employee';
  status: 'pending' | 'active' | 'rejected' | 'removed';
  version: number;
  owner: boolean;
  worksShifts: boolean;
  removedAt: Date | null;
  ownerGrantedById: string | null;
  ownerGrantedAt: Date | null;
  displayName: string | null;
  title: string | null;
  createdAt: Date;
  user: { id: string; name: string; email: string | null; avatarKey: string | null };
  avatarUrl?: string | null;
};

function present(m: MemberRow) {
  return {
    id: m.id,
    role: m.role,
    status: m.status,
    owner: m.owner,
    worksShifts: m.role === 'employee' || m.worksShifts,
    removedAt: m.removedAt,
    // Decided 2026-11-30: who made them an owner and when; that owner may undo it for 3 days.
    ownerGrantedBy: m.owner ? m.ownerGrantedById : null,
    ownerGrantedAt: m.owner ? m.ownerGrantedAt : null,
    // Decided 2026-11-29: the organization's name for the person (user.name stays their account
    // name) and their title.
    displayName: m.displayName,
    title: m.title,
    version: m.version,
    user: { id: m.user.id, name: m.user.name, email: m.user.email, avatarUrl: m.avatarUrl ?? null },
    createdAt: m.createdAt,
  };
}

/** ACC-7: admins add admins and change account types inside their organization. */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  list(user: AuthUser, org: OrgContext, input: ListMembersInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.membership.findMany({
        where: { organizationId: org.organizationId, status: input.status },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { user: { select: userFields } },
        ...pageArgs(input),
      });
      const left =
        input.status === 'removed'
          ? await this.leftovers(
              tx,
              org.organizationId,
              rows.map((r) => r.userId),
            )
          : null;
      const withAvatars = await Promise.all(
        rows.map(async (r) => ({
          ...r,
          avatarUrl: r.user.avatarKey ? await this.storage.signedUrl(r.user.avatarKey) : null,
        })),
      );
      return toPage(withAvatars, input, (m) => ({
        ...present(m),
        ...(left ? { leftover: left(m.user.id) } : {}),
      }));
    });
  }

  /**
   * Decided 2026-11-26: what a removed person still holds for the future (the things hand-over
   * clears or hands on), so the admin sees who still needs attention and who is done.
   */
  private async leftovers(tx: Tx, organizationId: string, userIds: string[]) {
    const ids = { in: userIds };
    const [shifts, places, ownTeams, tasks, assigneeTasks, rules, ingredients, products] =
      await Promise.all([
        tx.shift.groupBy({
          by: ['employeeId'],
          where: { organizationId, employeeId: ids },
          _count: true,
        }),
        tx.teamMember.groupBy({
          by: ['employeeId'],
          where: { organizationId, employeeId: ids, team: { deletedAt: null } },
          _count: true,
        }),
        tx.team.groupBy({
          by: ['ownerId'],
          where: { organizationId, ownerId: ids, shared: false, deletedAt: null },
          _count: true,
        }),
        tx.task.findMany({
          where: { organizationId, status: 'open', assigneeId: ids },
          select: { id: true, assigneeId: true },
        }),
        tx.taskAssignee.findMany({
          where: { organizationId, employeeId: ids, task: { status: 'open' } },
          select: { taskId: true, employeeId: true },
        }),
        tx.recurringTask.findMany({
          // A paused rule makes no more tasks, so it no longer counts.
          where: {
            organizationId,
            active: true,
            OR: [{ assigneeId: ids }, { assigneeIds: { hasSome: userIds } }],
          },
          select: { assigneeId: true, assigneeIds: true },
        }),
        tx.ingredientResponsibility.groupBy({
          by: ['employeeId'],
          where: { organizationId, employeeId: ids },
          _count: true,
        }),
        tx.employeeProduct.groupBy({
          by: ['employeeId'],
          where: { organizationId, employeeId: ids },
          _count: true,
        }),
      ]);
    const count = <K extends string>(
      rows: ({ _count: number } & Record<K, string | null>)[],
      key: K,
    ) => new Map(rows.map((r) => [r[key], r._count]));
    const shiftN = count(shifts, 'employeeId');
    const teamN = count(places, 'employeeId');
    const ownN = count(ownTeams, 'ownerId');
    const ingredientN = count(ingredients, 'employeeId');
    const productN = count(products, 'employeeId');
    return (userId: string) => {
      const taskIds = new Set([
        ...tasks.filter((t) => t.assigneeId === userId).map((t) => t.id),
        ...assigneeTasks.filter((a) => a.employeeId === userId).map((a) => a.taskId),
      ]);
      const left = {
        shiftDays: shiftN.get(userId) ?? 0,
        teams: (teamN.get(userId) ?? 0) + (ownN.get(userId) ?? 0),
        tasks: taskIds.size,
        repeatingTasks: rules.filter(
          (r) => r.assigneeId === userId || r.assigneeIds.includes(userId),
        ).length,
        ingredients: ingredientN.get(userId) ?? 0,
        products: productN.get(userId) ?? 0,
      };
      return { ...left, total: Object.values(left).reduce((n, x) => n + x, 0) };
    };
  }

  create(user: AuthUser, org: OrgContext, input: CreateMemberInput) {
    if (org.organizationType === 'contractor' && input.role !== 'admin')
      throw contractorAdminsOnly();
    if (input.role === 'admin') ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const person = await tx.user.findUnique({
        where: { email: input.email },
        select: userFields,
      });
      if (!person) {
        throw Errors.unprocessable(
          'ACCOUNT_NOT_FOUND',
          'No account uses this email. Ask the person to create an account first.',
        );
      }
      await assertNotInOrganization(tx, person.id, org.organizationId, 'they');
      const membership = await createMembershipOnce(
        () =>
          tx.membership.create({
            data: {
              organizationId: org.organizationId,
              userId: person.id,
              role: input.role,
              status: 'active',
              decidedById: user.userId,
              decidedAt: new Date(),
            },
            include: { user: { select: userFields } },
          }),
        'they',
      );
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'membership.create',
        entity: 'membership',
        entityId: membership.id,
        after: { ...membership, user: undefined },
      });
      return present(membership);
    });
  }

  update(user: AuthUser, org: OrgContext, id: string, version: number, input: UpdateMemberInput) {
    if (org.organizationType === 'contractor' && input.role === 'employee')
      throw contractorAdminsOnly();
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: { in: ['active', 'removed'] } },
      });
      if (!before) throw Errors.notFound('Member');
      if (before.status === 'removed') {
        throw Errors.conflict('MEMBER_REMOVED', 'This person is no longer a member.');
      }
      if (before.version !== version) throw Errors.versionConflict();
      // Decided 2026-11-26/27: an owner is never demoted or removed (they stop being an owner
      // first), and only owners make, demote or remove admins; anyone may step down themselves.
      const changesRole = input.role !== undefined && input.role !== before.role;
      if (before.owner && (changesRole || input.status === 'removed')) {
        throw Errors.conflict(
          'OWNER_PROTECTED',
          'An owner cannot be demoted or removed. They can stop being an owner themselves first.',
        );
      }
      const self = before.userId === user.userId && !user.viaBot;
      if (
        (changesRole && input.role === 'admin') ||
        (before.role === 'admin' && !self && (changesRole || input.status === 'removed'))
      ) {
        ownerOnly(user, org);
      }
      if (input.worksShifts !== undefined && (input.role ?? before.role) !== 'admin') {
        throw Errors.unprocessable('EMPLOYEES_ALWAYS_WORK', 'Employees always work shifts.');
      }
      const losesAdmin =
        before.role === 'admin' && (input.status === 'removed' || input.role === 'employee');
      if (losesAdmin) await this.assertAnotherAdmin(tx, org.organizationId, before.id);

      const result = await tx.membership.updateMany({
        where: { id, version },
        data: {
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status, removedAt: new Date() } : {}),
          ...(input.worksShifts !== undefined ? { worksShifts: input.worksShifts } : {}),
          ...(input.displayName !== undefined ? { displayName: input.displayName || null } : {}),
          ...(input.title !== undefined ? { title: input.title || null } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      const after = await tx.membership.findUniqueOrThrow({
        where: { id },
        include: { user: { select: userFields } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action:
          input.status === 'removed'
            ? 'membership.remove'
            : changesRole
              ? 'membership.role_change'
              : input.worksShifts !== undefined
                ? 'membership.works_shifts'
                : 'membership.profile',
        entity: 'membership',
        entityId: id,
        before,
        after: { ...after, user: undefined },
      });
      return present(after);
    });
  }

  /**
   * Decided 2026-11-27: ownership is shared. An owner makes another active member an owner too
   * (an employee becomes an admin as well) and stays an owner.
   */
  shareOwnership(user: AuthUser, org: OrgContext, id: string) {
    ownerOnly(user, org);
    return this.db.run(dbContext(user, org), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: 'active' },
      });
      if (!target) throw Errors.notFound('Member');
      if (target.owner) return this.presentOne(tx, id);
      await tx.membership.update({
        where: { id },
        data: {
          owner: true,
          role: 'admin',
          ownerGrantedById: user.userId,
          ownerGrantedAt: new Date(),
          ownerPreviousRole: target.role,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'membership.owner_add',
        entity: 'membership',
        entityId: id,
        before: { owner: false, role: target.role },
        after: { owner: true, role: 'admin' },
      });
      return this.presentOne(tx, id);
    });
  }

  /**
   * An owner stops being an owner (staying an admin). Only for oneself: owners never take
   * ownership from each other. The organization always keeps at least one owner.
   * Decided 2026-11-30: the one exception is undo. For 3 days the owner who made someone an
   * owner may take it back, and the person returns to the role they had before.
   */
  leaveOwnership(user: AuthUser, org: OrgContext, id: string) {
    ownerOnly(user, org);
    const self = id === org.membershipId;
    return this.db.run(dbContext(user, org), async (tx) => {
      const target = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: 'active', owner: true },
      });
      if (!target) throw Errors.notFound('Owner');
      if (!self) {
        if (target.ownerGrantedById !== user.userId) {
          throw Errors.forbidden('Owners can only stop being an owner themselves.');
        }
        if (!withinUndo(target.ownerGrantedAt)) throw undoExpired();
      }
      const owners = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM memberships
        WHERE organization_id = ${org.organizationId}::uuid AND owner AND status = 'active'
        FOR UPDATE`;
      if (!owners.some((o) => o.id !== id)) {
        throw Errors.conflict(
          'LAST_OWNER',
          'Make someone else an owner before you stop being one.',
        );
      }
      const role = self ? target.role : (target.ownerPreviousRole ?? target.role);
      await tx.membership.update({
        where: { id },
        data: {
          owner: false,
          role,
          ownerGrantedById: null,
          ownerGrantedAt: null,
          ownerPreviousRole: null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: self ? 'membership.owner_leave' : 'membership.owner_undo',
        entity: 'membership',
        entityId: id,
        before: { owner: true, role: target.role },
        after: { owner: false, role },
      });
      return this.presentOne(tx, id);
    });
  }

  /**
   * Decided 2026-11-30: undo a removal within 3 days. The person is a member again with the same
   * role; anything already handed over to someone else stays with them.
   */
  restore(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: 'removed' },
      });
      if (!member) throw Errors.notFound('Removed member');
      if (member.role === 'admin') ownerOnly(user, org);
      if (!withinUndo(member.removedAt)) throw undoExpired();
      const open = await tx.membership.findFirst({
        where: {
          organizationId: org.organizationId,
          userId: member.userId,
          status: { in: ['pending', 'active'] },
        },
        select: { id: true },
      });
      if (open) {
        throw Errors.conflict(
          'ALREADY_MEMBER',
          'They have joined or applied again since; decide that application instead.',
        );
      }
      const result = await tx.membership.updateMany({
        where: { id, version: member.version },
        data: { status: 'active', removedAt: null, version: { increment: 1 } },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'membership.restore',
        entity: 'membership',
        entityId: id,
        before: { status: 'removed', removedAt: member.removedAt },
        after: { status: 'active', removedAt: null },
      });
      return this.presentOne(tx, id);
    });
  }

  /**
   * Decided 2026-11-28: clears a person's future work, or hands it to another active member: the
   * weekly shift plan (days the new person already works stay theirs), teams (their own private
   * teams too), open tasks, repeating tasks, ingredient ordering and the products they log.
   * History (punches, output, finished tasks, audit) is never changed.
   */
  handOver(user: AuthUser, org: OrgContext, id: string, input: HandOverInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id, organizationId: org.organizationId, status: { in: ['active', 'removed'] } },
      });
      if (!member) throw Errors.notFound('Member');
      const from = member.userId;
      const to = input.toUserId;
      if (to === from) {
        throw Errors.validation({ toUserId: ['Choose another person.'] });
      }
      if (to) await activeMembers(tx, org.organizationId, [to]);
      const orgId = org.organizationId;
      const counts = {
        shiftDays: 0,
        shiftDaysKept: 0,
        teams: 0,
        tasks: 0,
        repeatingTasks: 0,
        ingredients: 0,
        products: 0,
      };

      // Weekly shift plan.
      const days = await tx.shift.findMany({ where: { organizationId: orgId, employeeId: from } });
      const taken = new Set(
        to
          ? (await tx.shift.findMany({ where: { organizationId: orgId, employeeId: to } })).map(
              (d) => d.weekday,
            )
          : [],
      );
      for (const d of days) {
        if (to && !taken.has(d.weekday)) {
          await tx.shift.update({
            where: { id: d.id },
            data: { employeeId: to, version: { increment: 1 } },
          });
          counts.shiftDays += 1;
        } else {
          await tx.shift.delete({ where: { id: d.id } });
          if (to) counts.shiftDaysKept += 1;
          else counts.shiftDays += 1;
        }
      }

      // Teams: their place goes to the new person; their own private teams too, or are closed.
      const places = await tx.teamMember.findMany({
        where: { organizationId: orgId, employeeId: from, team: { deletedAt: null } },
        select: { teamId: true },
      });
      for (const p of places) {
        await tx.teamMember.delete({
          where: { teamId_employeeId: { teamId: p.teamId, employeeId: from } },
        });
        if (to) {
          await tx.teamMember.createMany({
            data: [{ organizationId: orgId, teamId: p.teamId, employeeId: to }],
            skipDuplicates: true,
          });
        }
        await tx.team.update({ where: { id: p.teamId }, data: { version: { increment: 1 } } });
        counts.teams += 1;
      }
      const ownTeams = await tx.team.findMany({
        where: { organizationId: orgId, ownerId: from, shared: false, deletedAt: null },
        select: { id: true },
      });
      for (const team of ownTeams) {
        await tx.team.update({
          where: { id: team.id },
          data: to ? { ownerId: to, version: { increment: 1 } } : { deletedAt: new Date() },
        });
        if (to) {
          await tx.teamMember.createMany({
            data: [{ organizationId: orgId, teamId: team.id, employeeId: to }],
            skipDuplicates: true,
          });
        }
      }

      // Open tasks: theirs go to the new person, or to the admins.
      const open = await tx.task.findMany({
        where: {
          organizationId: orgId,
          status: 'open',
          OR: [{ assigneeId: from }, { assignees: { some: { employeeId: from } } }],
        },
        select: { id: true, assigneeId: true },
      });
      for (const task of open) {
        await tx.taskAssignee.deleteMany({ where: { taskId: task.id, employeeId: from } });
        if (to) {
          await tx.taskAssignee.createMany({
            data: [{ organizationId: orgId, taskId: task.id, employeeId: to }],
            skipDuplicates: true,
          });
        }
        if (task.assigneeId === from) {
          await tx.task.update({
            where: { id: task.id },
            data: { assigneeId: to ?? null, version: { increment: 1 } },
          });
        }
        counts.tasks += 1;
      }

      // Repeating tasks: the new person takes their place; with nobody left, the rule is paused.
      const rules = await tx.recurringTask.findMany({
        where: {
          organizationId: orgId,
          OR: [{ assigneeId: from }, { assigneeIds: { has: from } }],
        },
      });
      for (const r of rules) {
        const others = r.assigneeIds.filter((x) => x !== from);
        const ids = to && !others.includes(to) ? [...others, to] : others;
        const single = r.assigneeId === from;
        await tx.recurringTask.update({
          where: { id: r.id },
          data: single
            ? to
              ? { assigneeId: to, version: { increment: 1 } }
              : { active: false, version: { increment: 1 } }
            : ids.length
              ? { assigneeIds: ids, version: { increment: 1 } }
              : { assigneeIds: ids, active: false, version: { increment: 1 } },
        });
        counts.repeatingTasks += 1;
      }

      // Ingredient ordering and the products they log.
      const ingredients = await tx.ingredientResponsibility.findMany({
        where: { organizationId: orgId, employeeId: from },
        select: { ingredientId: true },
      });
      await tx.ingredientResponsibility.deleteMany({
        where: { organizationId: orgId, employeeId: from },
      });
      if (to && ingredients.length) {
        await tx.ingredientResponsibility.createMany({
          data: ingredients.map((i) => ({
            organizationId: orgId,
            ingredientId: i.ingredientId,
            employeeId: to,
          })),
          skipDuplicates: true,
        });
      }
      counts.ingredients = ingredients.length;
      const products = await tx.employeeProduct.findMany({
        where: { organizationId: orgId, employeeId: from },
        select: { productId: true },
      });
      await tx.employeeProduct.deleteMany({ where: { organizationId: orgId, employeeId: from } });
      if (to && products.length) {
        await tx.employeeProduct.createMany({
          data: products.map((p) => ({
            organizationId: orgId,
            productId: p.productId,
            employeeId: to,
          })),
          skipDuplicates: true,
        });
      }
      counts.products = products.length;

      await this.audit.record(tx, {
        organizationId: orgId,
        actor: actorFor(user),
        action: to ? 'membership.hand_over' : 'membership.clear_assignments',
        entity: 'membership',
        entityId: id,
        before: { userId: from },
        after: { toUserId: to, ...counts },
      });
      return { toUserId: to, ...counts };
    });
  }

  private async presentOne(tx: Tx, id: string) {
    const row = await tx.membership.findUniqueOrThrow({
      where: { id },
      include: { user: { select: userFields } },
    });
    return present(row);
  }

  /** An organization always keeps at least one active admin. Locks the admin rows first. */
  private async assertAnotherAdmin(tx: Tx, organizationId: string, excludingId: string) {
    const admins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM memberships
      WHERE organization_id = ${organizationId}::uuid AND role = 'admin' AND status = 'active'
      FOR UPDATE`;
    if (!admins.some((a) => a.id !== excludingId)) {
      throw Errors.conflict('LAST_ADMIN', 'Add another admin before changing the last one.');
    }
  }
}

/** Decided 2026-11-30: removing someone or making them an owner can be undone for 3 days. */
export const UNDO_DAYS = 3;
function withinUndo(at: Date | null): boolean {
  return at !== null && Date.now() - at.getTime() <= UNDO_DAYS * 86_400_000;
}
function undoExpired() {
  return Errors.conflict('UNDO_EXPIRED', `This can only be undone for ${UNDO_DAYS} days.`);
}

/** Decided 2026-11-26: only owners change who is an admin. The bot never does. */
function ownerOnly(user: AuthUser, org: OrgContext): void {
  if (!org.owner || user.viaBot) {
    throw Errors.forbidden('Only an owner can do this.');
  }
}

function contractorAdminsOnly() {
  return Errors.unprocessable(
    'CONTRACTOR_ADMINS_ONLY',
    'Contractor organizations have admins only in this version.',
  );
}
