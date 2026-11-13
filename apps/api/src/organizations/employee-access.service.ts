import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
import {
  EMPLOYEE_ACCESS_AREAS,
  EMPLOYEE_ACCESS_KEYS,
  type EmployeeAccess,
  resolveEmployeeAccess,
  type UpdateEmployeeAccessInput,
} from '../permissions/employee-access';

function present(version: number, access: EmployeeAccess) {
  return {
    version,
    areas: EMPLOYEE_ACCESS_KEYS.map((key) => ({
      key,
      label: EMPLOYEE_ACCESS_AREAS[key].label,
      enabled: access[key],
      defaultEnabled: EMPLOYEE_ACCESS_AREAS[key].default,
    })),
  };
}

/** The organization admin decides which read-only areas employees may see (decided 2026-11-12). */
@Injectable()
export class EmployeeAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const row = await this.load(tx, org.organizationId);
      return present(row.version, resolveEmployeeAccess(row.employeeAccess));
    });
  }

  update(user: AuthUser, org: OrgContext, version: number, input: UpdateEmployeeAccessInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const row = await this.load(tx, org.organizationId);
      if (row.version !== version) throw Errors.versionConflict();
      const before = resolveEmployeeAccess(row.employeeAccess);
      const after: EmployeeAccess = { ...before };
      for (const key of EMPLOYEE_ACCESS_KEYS) {
        const value = input[key];
        if (value !== undefined) after[key] = value;
      }
      const result = await tx.organization.updateMany({
        where: { id: org.organizationId, version },
        data: { employeeAccess: after, version: { increment: 1 } },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: 'organization.employee_access_update',
        entity: 'organization',
        entityId: org.organizationId,
        before,
        after,
      });
      return present(version + 1, after);
    });
  }

  private async load(tx: Tx, organizationId: string) {
    const row = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { version: true, employeeAccess: true },
    });
    if (!row) throw Errors.notFound('Organization');
    return row;
  }
}
