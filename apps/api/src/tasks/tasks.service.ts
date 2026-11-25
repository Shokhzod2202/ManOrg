import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { activeMembers, orgPeople } from '../common/memberships';
import { type AuthUser, dbContext, orgCan, type OrgContext } from '../common/request-context';
import { zonedToUtc } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import { NotificationsService } from '../notifications/notifications.service';
import { exifTakenAt } from '../storage/exif';
import { CONTENT_TYPES, newKey, sniffImage } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { type CreateTaskInput, type ListTasksInput, type UpdateTaskInput } from './tasks.schemas';

/** Task photos: JPEG or PNG up to 10 MB (spec section 12). */
export const MAX_TASK_PHOTO_BYTES = 10 * 1024 * 1024;
/** A capture token is valid this long after the camera opens. */
export const CAPTURE_TOKEN_MINUTES = 5;
/** A photo whose camera time is older than this is treated as picked from the gallery. */
export const MAX_PHOTO_AGE_MINUTES = 10;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const dateOf = (d: string) => new Date(`${d}T00:00:00Z`);

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  create(user: AuthUser, org: OrgContext, input: CreateTaskInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const who = await this.audience(tx, org, input);
      const task = await tx.task.create({
        data: {
          organizationId: org.organizationId,
          assigneeId: who.ids.length === 1 && !who.forAll ? who.ids[0]! : null,
          forAll: who.forAll,
          createdById: user.userId,
          title: input.title,
          description: input.description ?? null,
          dueDate: dateOf(input.dueDate),
          assignees: who.forAll
            ? undefined
            : // organization_id comes from the task through the composite key.
              { create: who.ids.map((employeeId) => ({ employeeId })) },
        },
        include: { assignees: { select: { employeeId: true } } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'task.create',
        entity: 'task',
        entityId: task.id,
        after: task,
      });
      // TSK-1: the people it is for are notified (for everyone: today's employees).
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: who.forAll ? await this.employees(tx, org) : who.ids,
        type: 'task.assigned',
        payload: { taskId: task.id, title: task.title, dueDate: input.dueDate },
      });
      return this.present(tx, task.id);
    });
  }

  /** Who a create or update names: everyone, or a checked list of active members. */
  private async audience(
    tx: Tx,
    org: OrgContext,
    input: { assigneeId?: string; assigneeIds?: string[]; forAll?: boolean },
  ): Promise<{ forAll: boolean; ids: string[] }> {
    if (input.forAll) return { forAll: true, ids: [] };
    const ids = [...new Set(input.assigneeIds ?? (input.assigneeId ? [input.assigneeId] : []))];
    await activeMembers(tx, org.organizationId, ids);
    return { forAll: false, ids };
  }

  private async employees(tx: Tx, org: OrgContext): Promise<string[]> {
    const rows = await tx.membership.findMany({
      where: { organizationId: org.organizationId, status: 'active', role: 'employee' },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** Tasks this person may see and finish: theirs, shared with them, or for everyone. */
  private forPerson(userId: string) {
    return [
      { assigneeId: userId },
      { forAll: true },
      { assignees: { some: { employeeId: userId } } },
    ];
  }

  /** Admins and the bot see every task; an employee sees tasks assigned to them. */
  list(user: AuthUser, org: OrgContext, input: ListTasksInput) {
    const all = orgCan(org, 'tasks.manage');
    return this.db.run(dbContext(user, org), async (tx) => {
      const rows = await tx.task.findMany({
        where: {
          organizationId: org.organizationId,
          ...(input.status ? { status: input.status } : {}),
          ...(input.type ? { taskType: input.type } : {}),
          ...(all ? {} : { OR: this.forPerson(user.userId) }),
        },
        orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
        take: 500,
      });
      return {
        items: await Promise.all(rows.map((r) => this.present(tx, r.id))),
        nextCursor: null,
      };
    });
  }

  get(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const task = await this.visible(tx, user, org, id);
      return this.present(tx, task.id);
    });
  }

  update(user: AuthUser, org: OrgContext, id: string, version: number, input: UpdateTaskInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await tx.task.findFirst({ where: { id, organizationId: org.organizationId } });
      if (!before) throw Errors.notFound('Task');
      if (before.status === 'done')
        throw Errors.conflict('TASK_DONE', 'A done task cannot be changed.');
      if (before.version !== version) throw Errors.versionConflict();
      const changesWho =
        input.assigneeId !== undefined ||
        input.assigneeIds !== undefined ||
        input.forAll !== undefined;
      const who = changesWho ? await this.audience(tx, org, input) : null;
      const beforeIds = new Set([
        ...(before.assigneeId ? [before.assigneeId] : []),
        ...(
          await tx.taskAssignee.findMany({ where: { taskId: id }, select: { employeeId: true } })
        ).map((a) => a.employeeId),
      ]);
      const result = await tx.task.updateMany({
        where: { id, version },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(who
            ? {
                forAll: who.forAll,
                assigneeId: who.ids.length === 1 && !who.forAll ? who.ids[0]! : null,
              }
            : {}),
          ...(input.dueDate !== undefined ? { dueDate: dateOf(input.dueDate) } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      if (who) {
        await tx.taskAssignee.deleteMany({ where: { taskId: id } });
        if (who.ids.length) {
          await tx.taskAssignee.createMany({
            data: who.ids.map((employeeId) => ({
              organizationId: org.organizationId,
              taskId: id,
              employeeId,
            })),
          });
        }
      }
      const after = await tx.task.findUniqueOrThrow({
        where: { id },
        include: { assignees: { select: { employeeId: true } } },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'task.update',
        entity: 'task',
        entityId: id,
        before: { ...before, assigneeIds: [...beforeIds] },
        after,
      });
      // People newly given the task are told.
      if (who) {
        const now = who.forAll && !before.forAll ? await this.employees(tx, org) : who.ids;
        const added = now.filter((u) => !beforeIds.has(u));
        if (added.length) {
          await this.notifications.notify(tx, {
            organizationId: org.organizationId,
            userIds: added,
            type: 'task.assigned',
            payload: { taskId: id, title: after.title },
          });
        }
      }
      return this.present(tx, id);
    });
  }

  /**
   * TSK-2, step 1: the app asks for a one-time token as it opens the camera. The photo must be
   * sent with it within CAPTURE_TOKEN_MINUTES.
   */
  captureToken(user: AuthUser, org: OrgContext, id: string) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const task = await this.ownOpenTask(tx, user, org, id);
      const token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + CAPTURE_TOKEN_MINUTES * 60_000);
      await tx.task.update({
        where: { id: task.id },
        data: { captureTokenHash: hash(token), captureTokenExpires: expiresAt },
      });
      return { captureToken: token, expiresAt };
    });
  }

  /**
   * TSK-2, step 2: done only with a camera photo (CLAUDE.md rule 5). Gallery uploads are refused:
   * the photo needs the fresh one-time capture token, and a JPEG whose camera time is older than
   * MAX_PHOTO_AGE_MINUTES is rejected. Capture time is recorded by the server.
   */
  complete(
    user: AuthUser,
    org: OrgContext,
    id: string,
    captureToken: string | undefined,
    file: Express.Multer.File | undefined,
  ) {
    if (!file) throw Errors.validation({ photo: ['Take a picture to finish the task.'] });
    if (!captureToken)
      throw Errors.validation({
        captureToken: ['Open the camera from the app to take the picture.'],
      });
    if (file.size > MAX_TASK_PHOTO_BYTES)
      throw Errors.validation({ photo: ['Use a photo of at most 10 MB.'] });
    const ext = sniffImage(file.buffer);
    if (ext !== 'jpg' && ext !== 'png')
      throw Errors.validation({ photo: ['Use a JPEG or PNG photo from the camera.'] });
    return this.db.run(dbContext(user, org), async (tx) => {
      const task = await this.ownOpenTask(tx, user, org, id);
      const now = new Date();
      if (
        !task.captureTokenHash ||
        !task.captureTokenExpires ||
        task.captureTokenExpires < now ||
        task.captureTokenHash !== hash(captureToken)
      ) {
        throw Errors.unprocessable(
          'CAMERA_REQUIRED',
          'Take the picture with the camera in the app; gallery pictures are not accepted.',
        );
      }
      const taken = exifTakenAt(file.buffer);
      if (taken) {
        const { timezone } = await tx.organization.findUniqueOrThrow({
          where: { id: org.organizationId },
          select: { timezone: true },
        });
        const [d, t] = taken.split(' ') as [string, string];
        const takenAt = zonedToUtc(d.replaceAll(':', '-'), t.slice(0, 5), timezone);
        if (now.getTime() - takenAt.getTime() > MAX_PHOTO_AGE_MINUTES * 60_000) {
          throw Errors.unprocessable(
            'CAMERA_REQUIRED',
            'This picture was taken earlier; take a new one with the camera.',
          );
        }
      }
      const key = newKey(org.organizationId, 'task', ext);
      await this.storage.put(key, file.buffer, CONTENT_TYPES[ext]);
      await tx.taskPhoto.create({
        data: {
          organizationId: org.organizationId,
          taskId: task.id,
          fileUrl: key,
          contentType: CONTENT_TYPES[ext],
          sizeBytes: file.size,
        },
      });
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: 'done',
          completedAt: now,
          completedById: user.userId,
          captureTokenHash: null,
          captureTokenExpires: null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'task.complete',
        entity: 'task',
        entityId: task.id,
        before: { status: 'open' },
        after: { status: 'done', completedAt: now, photoKey: key },
      });
      await this.notifications.notify(tx, {
        organizationId: org.organizationId,
        userIds: await this.notifications.admins(tx, org.organizationId),
        type: 'task.completed',
        payload: { taskId: task.id, title: task.title, by: user.userId },
      });
      return this.present(tx, task.id);
    });
  }

  private async ownOpenTask(tx: Tx, user: AuthUser, org: OrgContext, id: string) {
    const task = await tx.task.findFirst({
      where: { id, organizationId: org.organizationId, OR: this.forPerson(user.userId) },
    });
    if (!task) throw Errors.notFound('Task');
    if (task.status === 'done') throw Errors.conflict('TASK_DONE', 'This task is already done.');
    return task;
  }

  private async visible(tx: Tx, user: AuthUser, org: OrgContext, id: string) {
    const task = await tx.task.findFirst({
      where: {
        id,
        organizationId: org.organizationId,
        ...(orgCan(org, 'tasks.manage') ? {} : { OR: this.forPerson(user.userId) }),
      },
    });
    if (!task) throw Errors.notFound('Task');
    return task;
  }

  /** TSK-3: done tasks carry the photo (short-lived link), completion time and who did it. */
  async present(tx: Tx, id: string) {
    const task = await tx.task.findUniqueOrThrow({
      where: { id },
      include: {
        photos: { orderBy: { takenAt: 'desc' } },
        ingredientOrders: { select: { id: true } },
        assignees: { select: { employeeId: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    const shared = task.assignees.map((a) => a.employeeId);
    const ids = [task.assigneeId, task.completedById, task.createdById, ...shared].filter(
      (x): x is string => !!x,
    );
    // Decided 2026-11-29: as the organization names them.
    const people = [...(await orgPeople(tx, task.organizationId, ids)).values()].map((x) => ({
      id: x.id,
      name: x.name,
    }));
    const person = (pid: string | null) =>
      pid ? (people.find((p) => p.id === pid) ?? null) : null;
    return {
      id: task.id,
      type: task.taskType,
      title: task.title,
      description: task.description,
      assignee: person(task.assigneeId),
      assignees: (shared.length ? shared : task.assigneeId ? [task.assigneeId] : [])
        .map(person)
        .filter((p): p is { id: string; name: string } => p !== null),
      forAll: task.forAll,
      createdBy: person(task.createdById),
      dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : null,
      recurringTaskId: task.recurringTaskId,
      status: task.status,
      completedAt: task.completedAt,
      completedBy: person(task.completedById),
      photos: await Promise.all(
        task.photos.map(async (p) => ({
          id: p.id,
          url: await this.storage.signedUrl(p.fileUrl),
          takenAt: p.takenAt,
        })),
      ),
      ingredientOrderId: task.ingredientOrders[0]?.id ?? null,
      version: task.version,
      createdAt: task.createdAt,
    };
  }
}
