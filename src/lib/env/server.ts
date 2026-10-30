import "server-only";

import { parseAuthEnv, getRuntimeDatabaseEnv } from "./validation";

// No eager reads: source generation, typecheck, and login rendering need no secrets.
export function getAuthEnv() {
  return parseAuthEnv();
}

export { getRuntimeDatabaseEnv };
