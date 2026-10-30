import { compare, hash } from "bcryptjs";

const PASSWORD_COST = 12;
// Hash of a discarded random value; never an application credential.
const DUMMY_HASH = "$2b$12$.B9IrolclwOu7mXKm9Y6X.4BieACPE.QnsDbv/d.zbnoBm4.Rz0Ha";

export function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_COST);
}

export async function verifyPassword(password: string, passwordHash: string | null): Promise<boolean> {
  // Unknown emails still perform a bcrypt comparison to avoid a fast user lookup oracle.
  const comparisonHash = passwordHash ?? DUMMY_HASH;
  const matches = await compare(password, comparisonHash);
  return passwordHash !== null && matches;
}
