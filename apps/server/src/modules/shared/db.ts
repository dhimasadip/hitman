import type { Database } from "@hitman/database";

export type Db = Database["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbExecutor = Db | Tx;

export function isUniqueViolation(error: unknown): boolean {
  return hasDatabaseCode(error, "23505");
}

function hasDatabaseCode(error: unknown, code: string, depth = 0): boolean {
  if (depth > 4 || typeof error !== "object" || error === null) return false;
  if ("code" in error && (error as { code?: unknown }).code === code) return true;
  if ("cause" in error) {
    return hasDatabaseCode((error as { cause?: unknown }).cause, code, depth + 1);
  }
  return false;
}
