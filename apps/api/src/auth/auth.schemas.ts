import { z } from 'zod';

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Enter a valid email address.' }))
  .refine((v) => v.length <= 254, 'Email is too long.');

export const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use at most 200 characters.');

export const personName = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(100, 'Use at most 100 characters.');

export const registerSchema = z.strictObject({ name: personName, email, password });
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(200) });
export const refreshSchema = z.strictObject({ refreshToken: z.string().min(10).max(500) });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
