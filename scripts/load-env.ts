import { resolve } from "node:path";
import { config } from "dotenv";

export function loadLocalEnv(directory = process.cwd()) {
  // Process > .env.local > .env. Never rewrite or print the user's secrets.
  config({ path: resolve(directory, ".env.local"), override: false, quiet: true });
  config({ path: resolve(directory, ".env"), override: false, quiet: true });
}
