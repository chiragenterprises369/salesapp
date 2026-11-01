import argon2 from 'argon2';

let dummyHash: Promise<string> | null = null;

/** argon2id hash (library defaults; same as the seed). */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Constant-work password check. When there is no stored hash (unknown email, Google-only account)
 * a dummy hash is verified anyway so response time does not reveal whether the email exists.
 */
export async function verifyPassword(hash: string | null | undefined, password: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= argon2.hash('vistar-timing-equaliser', { type: argon2.argon2id });
    await argon2.verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
