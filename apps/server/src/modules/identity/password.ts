import { hash, verify } from "@node-rs/argon2";

const ARGON_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/**
 * A valid Argon2id hash of a fixed, non-secret development value. Verifying an
 * unknown email against this hash keeps failed-login timing closer to a known
 * account without storing or using a real password.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$8rTZthxtAcmioCD3hDLL4w$nkCY+W1TVfZCYI139GCDgjWw29jJFaEO2kcVufMYMvM";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  return verify(passwordHash ?? DUMMY_PASSWORD_HASH, password, ARGON_OPTIONS);
}

export function dummyPasswordHash(): string {
  return DUMMY_PASSWORD_HASH;
}
