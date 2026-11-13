import { z } from 'zod';

/**
 * Areas of organization data an admin can open to employees, read-only (decided 2026-11-12, see
 * docs/DECISIONS.md). Each switch only grants reading; no setting lets an employee change data.
 * Defaults follow the spec: employees see everyone's shifts (section 2) and the orders due next
 * (TOD-1 to TOD-7); everything else starts closed.
 */
export const EMPLOYEE_ACCESS_AREAS = {
  allShifts: { default: true, label: "All employees' shifts (main dashboard)" },
  ordersDueNext: { default: true, label: "Orders due next (Today's Orders and My Orders)" },
  ordersHistory: { default: false, label: 'Monthly orders list' },
  deliveries: { default: false, label: 'Deliveries' },
  outputAll: { default: false, label: "Everyone's daily output" },
  ingredientPrices: { default: false, label: 'Ingredient prices' },
  finance: { default: false, label: 'Finance: delivery values, payments and settlements' },
} as const;

export type EmployeeAccessKey = keyof typeof EMPLOYEE_ACCESS_AREAS;
export type EmployeeAccess = Record<EmployeeAccessKey, boolean>;

export const EMPLOYEE_ACCESS_KEYS = Object.keys(EMPLOYEE_ACCESS_AREAS) as EmployeeAccessKey[];

/** The stored JSON merged over the defaults; unknown or malformed values fall back to defaults. */
export function resolveEmployeeAccess(stored: unknown): EmployeeAccess {
  const source =
    typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const out = {} as EmployeeAccess;
  for (const key of EMPLOYEE_ACCESS_KEYS) {
    const value = source[key];
    out[key] = typeof value === 'boolean' ? value : EMPLOYEE_ACCESS_AREAS[key].default;
  }
  return out;
}

export const updateEmployeeAccessSchema = z
  .strictObject(
    Object.fromEntries(EMPLOYEE_ACCESS_KEYS.map((k) => [k, z.boolean().optional()])) as Record<
      EmployeeAccessKey,
      z.ZodOptional<z.ZodBoolean>
    >,
  )
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one area.');

export type UpdateEmployeeAccessInput = z.infer<typeof updateEmployeeAccessSchema>;
