import { z } from 'zod';

export interface SwitchArea {
  default: boolean;
  label: string;
}

/**
 * A set of on/off switches stored as JSON on the organization. Missing or malformed values fall
 * back to the defaults, so adding a switch never needs a data migration.
 */
export function defineSwitches<const A extends Record<string, SwitchArea>>(areas: A) {
  type Key = keyof A & string;
  const keys = Object.keys(areas) as Key[];
  const resolve = (stored: unknown): Record<Key, boolean> => {
    const source =
      typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
    const out = {} as Record<Key, boolean>;
    for (const key of keys) {
      const value = source[key];
      out[key] = typeof value === 'boolean' ? value : (areas[key] as SwitchArea).default;
    }
    return out;
  };
  const updateSchema = z
    .strictObject(
      Object.fromEntries(keys.map((k) => [k, z.boolean().optional()])) as Record<
        Key,
        z.ZodOptional<z.ZodBoolean>
      >,
    )
    .refine((v) => Object.values(v).some((x) => x !== undefined), 'Send at least one switch.');
  return { areas, keys, resolve, updateSchema };
}
