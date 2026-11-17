import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { actorFor, AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { type AuthUser, dbContext, type OrgContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { type Tx } from '../database/prisma-client';
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
        actor: actorFor(user),
        action: setting.audit,
        entity: 'organization',
        entityId: org.organizationId,
        before,
        after,
      });
      return present(switches, version + 1, after);
    });
  }

  /** Spec section 9: where the bakery is, for the phone's geofence. Any member may read it. */
  location(user: AuthUser, org: OrgContext) {
    return this.db.run(dbContext(user, org), async (tx) =>
      presentLocation(await this.locationRow(tx, org)),
    );
  }

  /** The admin sets the location, radius and window; audited. Employees' locations are never stored. */
  updateLocation(user: AuthUser, org: OrgContext, version: number, input: LocationInput) {
    return this.db.run(dbContext(user, org), async (tx) => {
      const before = await this.locationRow(tx, org);
      if (before.version !== version) throw Errors.versionConflict();
      const next = {
        latitude:
          input.latitude !== undefined
            ? input.latitude
            : before.latitude === null
              ? null
              : Number(before.latitude),
        longitude:
          input.longitude !== undefined
            ? input.longitude
            : before.longitude === null
              ? null
              : Number(before.longitude),
      };
      if (
        (input.enabled ?? before.arrivalPromptEnabled) &&
        (next.latitude === null || next.longitude === null)
      ) {
        throw Errors.validation({
          enabled: ['Set the bakery location before turning the arrival prompt on.'],
        });
      }
      await tx.organization.update({
        where: { id: org.organizationId },
        data: {
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.radiusM !== undefined ? { geofenceRadiusM: input.radiusM } : {}),
          ...(input.windowBeforeMin !== undefined
            ? { arrivalWindowBeforeMin: input.windowBeforeMin }
            : {}),
          ...(input.windowAfterMin !== undefined
            ? { arrivalWindowAfterMin: input.windowAfterMin }
            : {}),
          ...(input.enabled !== undefined ? { arrivalPromptEnabled: input.enabled } : {}),
          version: { increment: 1 },
        },
      });
      const after = await this.locationRow(tx, org);
      await this.audit.record(tx, {
        organizationId: org.organizationId,
        actor: actorFor(user),
        action: 'organization.location',
        entity: 'organization',
        entityId: org.organizationId,
        before: presentLocation(before),
        after: presentLocation(after),
      });
      return presentLocation(after);
    });
  }

  private async locationRow(tx: Tx, org: OrgContext) {
    const row = await tx.organization.findUnique({
      where: { id: org.organizationId },
      select: {
        version: true,
        latitude: true,
        longitude: true,
        geofenceRadiusM: true,
        arrivalPromptEnabled: true,
        arrivalWindowBeforeMin: true,
        arrivalWindowAfterMin: true,
      },
    });
    if (!row) throw Errors.notFound('Organization');
    return row;
  }
}

function presentLocation(row: {
  version: number;
  latitude: unknown;
  longitude: unknown;
  geofenceRadiusM: number;
  arrivalPromptEnabled: boolean;
  arrivalWindowBeforeMin: number;
  arrivalWindowAfterMin: number;
}) {
  return {
    version: row.version,
    enabled: row.arrivalPromptEnabled,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    radiusM: row.geofenceRadiusM,
    windowBeforeMin: row.arrivalWindowBeforeMin,
    windowAfterMin: row.arrivalWindowAfterMin,
  };
}

export const locationSchema = z
  .strictObject({
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    radiusM: z.number().int().min(30, 'At least 30 m.').max(1000, 'At most 1000 m.').optional(),
    windowBeforeMin: z.number().int().min(0).max(240).optional(),
    windowAfterMin: z.number().int().min(0).max(240).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one field.');
export type LocationInput = z.infer<typeof locationSchema>;
