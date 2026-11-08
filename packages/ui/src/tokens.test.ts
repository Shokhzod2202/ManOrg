import { describe, expect, it } from 'vitest';
import { colors, employeeColor, employeePalette } from './tokens';

describe('tokens', () => {
  it('never uses the reserved flag red for an employee colour', () => {
    expect(employeePalette).not.toContain(colors.flag);
  });

  it('cycles the employee palette for any index', () => {
    expect(employeeColor(0)).toBe(employeePalette[0]);
    expect(employeeColor(employeePalette.length)).toBe(employeePalette[0]);
    expect(employeeColor(-1)).toBe(employeePalette[employeePalette.length - 1]);
  });
});
