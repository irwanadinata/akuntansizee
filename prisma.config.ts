import { defineConfig } from "prisma/config";

import { loadLocalEnv } from "./scripts/load-env";
import { getDirectDatabaseUrl } from "./src/lib/env/validation";

loadLocalEnv();

const commands = process.argv.slice(2);
const needsDatabase = (commands.includes("db") && !commands.includes("seed")) || commands.includes("studio") ||
  (commands.includes("migrate") && !commands.includes("diff")) ||
  commands.some((command) => command.includes("config-datasource"));

// Offline generate/validate/format/diff works without a fabricated connection URL.
// A command that touches a database always requires a validated DIRECT_URL.
const directUrl = needsDatabase || process.env.DIRECT_URL
  ? getDirectDatabaseUrl()
  : undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node --conditions=react-server --import tsx prisma/seed.ts" },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
