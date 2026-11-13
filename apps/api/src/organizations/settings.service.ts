import { Injectable } from '@nestjs/common';
import { AuditService, userActor } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { botAccessSwitches } from '../permissions/bot-access';
import { employeeAccessSwitches } from '../permissions/employee-access';
import { type SwitchArea } from '../permissions/switches';

/** Organization settings made of on/off switches, each stored in one JSON column. */
const SETTINGS = {
  employeeAccess: {
    switches: employeeAccessSwitches,
    audit: 'organization.employee_access_update',
  },
  botAccess: { switches: botAccessSwitches, audit: 'organization.bot_access_update' },
} as const;

export type SettingName = keyof typeof SETTINGS;

interface Switches {
  areas: Record<string, SwitchArea>;
  keys: readonly string[];
  resolve: (stored: unknown) => Record<string, boolean>;
}

function present(switches: Switches, version: number, values: Record<string, boolean>) {
  return {
    version,
    areas: switches.keys.map((key) => ({
      key,
      label: switches.areas[key]!.label,
      enabled: values[key]!,
      defaultEnabled: switches.areas[key]!.default,
    })),
  };
}

/** Employee access (decided 2026-11-12) and Bot permissions (decided 2026-11-13). */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  get(user: AuthUser, org: OrgContext, name: SettingName) {
    const switches = SETTINGS[name].switches as unknown as Switches;
    return this.db.run(dbContext(user, org), async (tx) => {
      const row = await tx.organization.findUnique({
        where: { id: org.organizationId },
        select: { version: true, employeeAccess: true, botAccess: true },
      });
      if (!row) throw Errors.notFound('Organization');
      return present(switches, row.version, switches.resolve(row[name]));
    });
  }

  update(
    user: AuthUser,
    org: OrgContext,
    name: SettingName,
    version: number,
    input: Record<string, boolean | undefined>,
  ) {
    const setting = SETTINGS[name];
    const switches = setting.switches as unknown as Switches;
    return this.db.run(dbContext(user, org), async (tx) => {
      const row = await tx.organization.findUnique({
        where: { id: org.organizationId },
        select: { version: true, employeeAccess: true, botAccess: true },
      });
      if (!row) throw Errors.notFound('Organization');
      if (row.version !== version) throw Errors.versionConflict();
      const before = switches.resolve(row[name]);
      const after = { ...before };
      for (const key of switches.keys) {
        const value = input[key];
        if (value !== undefined) after[key] = value;
      }
      const result = await tx.organization.updateMany({
        where: { id: org.organizationId, version },
        data: { [name]: after, version: { increment: 1 } },
      });
      if (result.count !== 1) throw Errors.versionConflict();
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: userActor(user.userId),
        action: setting.audit,
        entity: 'organization',
        entityId: org.organizationId,
        before,
        after,
      });
      return present(switches, version + 1, after);
    });
  }
}
