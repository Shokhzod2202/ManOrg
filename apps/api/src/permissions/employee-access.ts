import { type z } from 'zod';
import { defineSwitches } from './switches';

/**
 * Areas of organization data an admin can open to employees, read-only (decided 2026-11-12, see
 * docs/DECISIONS.md). Each switch only grants reading; no setting lets an employee change data.
 * Defaults follow the spec: employees see everyone's shifts (section 2) and the orders due next
 * (TOD-1 to TOD-7); everything else starts closed.
 */
export const employeeAccessSwitches = defineSwitches({
  allShifts: { default: true, label: "All employees' shifts (main dashboard)" },
  ordersDueNext: { default: true, label: "Orders due next (Today's Orders and My Orders)" },
  ordersHistory: { default: false, label: 'Monthly orders list' },
  deliveries: { default: false, label: 'Deliveries' },
  outputAll: { default: false, label: "Everyone's daily output" },
  ingredientPrices: { default: false, label: 'Ingredient prices' },
  finance: { default: false, label: 'Finance: delivery values, payments and settlements' },
});

export const EMPLOYEE_ACCESS_AREAS = employeeAccessSwitches.areas;
export const EMPLOYEE_ACCESS_KEYS = employeeAccessSwitches.keys;
export type EmployeeAccessKey = (typeof EMPLOYEE_ACCESS_KEYS)[number];
export type EmployeeAccess = Record<EmployeeAccessKey, boolean>;
export const resolveEmployeeAccess = employeeAccessSwitches.resolve;
export const updateEmployeeAccessSchema = employeeAccessSwitches.updateSchema;
export type UpdateEmployeeAccessInput = z.infer<typeof updateEmployeeAccessSchema>;
