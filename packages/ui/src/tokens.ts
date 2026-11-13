/**
 * Design tokens shared by the web and mobile apps.
 *
 * Interface rule (spec section 11): red is reserved for differences and errors and is never
 * decoration. A flag must also carry an icon and text, so colour is never the only signal.
 */
export const colors = {
  /** Haydar Inc brand (decided 2026-11-13): logo blue on a clean white background. */
  background: '#ffffff',
  surface: '#f4f7fc',
  text: '#0f1a33',
  textMuted: '#566078',
  border: '#e4e8f0',
  primary: '#0b3a8c',
  primaryDark: '#082c6b',
  primarySoft: '#eaf0fa',
  onPrimary: '#ffffff',
  /** Reserved: punch differences, validation errors, failed actions. */
  flag: '#c62828',
  flagSurface: '#fbebeb',
  success: '#24622a',
} as const;

/** Montserrat for headings (close to the logo lettering), Inter for text. */
export const fonts = {
  heading: "Montserrat, 'Helvetica Neue', Arial, sans-serif",
  body: "Inter, 'Helvetica Neue', Arial, sans-serif",
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
