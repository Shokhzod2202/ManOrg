/**
 * Design tokens shared by the web and mobile apps.
 *
 * Interface rule (spec section 11): red is reserved for differences and errors and is never
 * decoration. A flag must also carry an icon and text, so colour is never the only signal.
 */
export const colors = {
  background: '#ffffff',
  surface: '#f6f6f4',
  text: '#1c1c1a',
  textMuted: '#5f5e5a',
  border: '#dedcd6',
  primary: '#2f5d8a',
  onPrimary: '#ffffff',
  /** Reserved: punch differences, validation errors, failed actions. */
  flag: '#c62828',
  flagSurface: '#fbebeb',
  success: '#2e7d32',
} as const;

/** One colour per employee on calendar dashboards (SHF-8). Red is deliberately excluded. */
export const employeePalette = [
  '#2f5d8a',
  '#6a4c93',
  '#1b7f79',
  '#b5651d',
  '#5b7f2a',
  '#8a3f6b',
  '#3d6fb4',
  '#7a6a1f',
] as const;

/** Minimum touch target in px (spec section 11). */
export const minTouchTarget = 44;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export function employeeColor(index: number): string {
  const palette = employeePalette;
  return palette[((index % palette.length) + palette.length) % palette.length] ?? palette[0];
}
