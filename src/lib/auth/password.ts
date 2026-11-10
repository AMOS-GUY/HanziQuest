import bcrypt from "bcryptjs";

/** bcrypt work factor. 12 ≈ 200–300 ms per hash on typical server hardware. */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * A precomputed hash used to keep sign-in timing similar whether or not the email exists,
 * which makes account enumeration through response timing harder.
 */
const DUMMY_HASH = "$2b$12$oTcyGSDleaDF1Pp8zcklIOZucxV23Huo/JEZCpWbD8ZKFvvPUMwU6";

export async function verifyPasswordConstantTime(
  password: string,
  hash: string | null | undefined,
) {
  if (!hash) {
    await bcrypt.compare(password, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(password, hash);
}
