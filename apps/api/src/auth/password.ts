import { hash, verify } from '@node-rs/argon2';

/** Argon2id with the library's defaults (spec section 12). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  if (!passwordHash) return verifyAgainstDummy(password);
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so sign-in does not reveal which emails exist. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hash('not-a-real-password-placeholder');
  await verifyPassword(await dummyHash, password);
  return false;
}
