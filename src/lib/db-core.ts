import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../generated/prisma/client";
import { getDirectDatabaseUrl, getRuntimeDatabaseEnv } from "./env/validation";

const globalForPrisma = globalThis as unknown as { zeePrisma?: PrismaClient };

// Only server code and trusted CLI scripts may import this module.
// Construction is lazy; importing this file never connects to a database.
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.zeePrisma) {
    const { DATABASE_URL } = getRuntimeDatabaseEnv();
    globalForPrisma.zeePrisma = new PrismaClient({
      adapter: new PrismaNeon({ connectionString: DATABASE_URL }),
      // Do not emit Prisma errors containing connection details or query inputs.
      log: [],
      errorFormat: "minimal",
    });
  }
  return globalForPrisma.zeePrisma;
}

// Explicit administrative connection: callers must disconnect after completion.
export function createDirectPrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaNeon({ connectionString: getDirectDatabaseUrl() }),
    log: [],
    errorFormat: "minimal",
  });
}
