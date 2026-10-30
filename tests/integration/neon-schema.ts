import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient, type Prisma } from "../../src/generated/prisma/client";
import { parseNeonUrl } from "../../src/lib/env/validation";
// PostgreSQL statements may contain semicolons inside quoted function bodies.
export function sqlStatements(sql: string): string[] {
  const output: string[] = []; let start = 0, index = 0, quote = "", dollar = "", lineComment = false, blockDepth = 0;
  while (index < sql.length) {
    const c = sql[index], next = sql[index + 1];
    if (lineComment) { if (c === "\n") lineComment = false; index++; continue; }
    if (blockDepth) { if (c === "/" && next === "*") { blockDepth++; index += 2; } else if (c === "*" && next === "/") { blockDepth--; index += 2; } else index++; continue; }
    if (dollar) { if (sql.startsWith(dollar, index)) { index += dollar.length; dollar = ""; } else index++; continue; }
    if (quote) { if (c === quote) { if (next === quote) index += 2; else { quote = ""; index++; } } else index++; continue; }
    if (c === "-" && next === "-") { lineComment = true; index += 2; continue; }
    if (c === "/" && next === "*") { blockDepth = 1; index += 2; continue; }
    if (c === "'" || c === '"') { quote = c; index++; continue; }
    if (c === "$") { const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/); if (match) { dollar = match[0]; index += dollar.length; continue; } }
    if (c === ";") { const statement = sql.slice(start, index).trim(); if (statement) output.push(statement); start = index + 1; }
    index++;
  }
  if (quote || dollar || blockDepth) throw new Error("SQL migration tidak lengkap.");
  if (sql.slice(start).trim()) output.push(sql.slice(start).trim());
  return output;
}
export async function isolatedNeon(url: string) {
  const connectionString = parseNeonUrl(url, "DIRECT_URL");
  const schema = "zee_journal_test_" + randomUUID().replace(/-/g, "");
  if (!/^zee_journal_test_[a-f0-9]{32}$/.test(schema)) throw new Error("Nama schema test ditolak.");
  const directClient = () => new PrismaClient({ adapter: new PrismaNeon({ connectionString }), log: [], errorFormat: "minimal" });
  const admin = directClient();
  const actual = new PrismaClient({ adapter: new PrismaNeon({ connectionString }, { schema }), log: [], errorFormat: "minimal" });
  const transaction = async <T>(work: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) => actual.$transaction(async tx => {
    // No public fallback: missing test objects must fail, never touch application tables.
    await tx.$executeRawUnsafe('SET LOCAL search_path TO "' + schema + '"');
    return work(tx);
  }, options);
  const db = new Proxy(actual, { get(target, property) {
    if (property === "$transaction") return transaction;
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const cleanup = async () => {
    await Promise.allSettled([actual.$disconnect(), admin.$disconnect()]);
    // A long browser run may outlive an idle Neon connection. Use a fresh
    // connection for teardown, and retry only this idempotent, owned-schema DDL.
    for (let attempt = 0; attempt < 3; attempt++) {
      const cleaner = directClient();
      try {
        await cleaner.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
        const remaining = await cleaner.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM pg_namespace WHERE nspname=${schema}`;
        if (remaining[0].count === 0n) return;
      } catch { /* Retry with a fresh connection; never print connection details. */ }
      finally { await Promise.allSettled([cleaner.$disconnect()]); }
    }
    throw new Error("Pembersihan schema test " + schema + " belum selesai setelah 3 percobaan.");
  };
  try {
    await admin.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
    const root = new URL("../../prisma/migrations/", import.meta.url);
    for (const directory of readdirSync(root).filter(name => /^\d/.test(name)).sort()) {
      const statements = sqlStatements(readFileSync(new URL(directory + "/migration.sql", root), "utf8"));
      await transaction(async tx => { for (const sql of statements) await tx.$executeRawUnsafe(sql); }, { timeout: 120000 });
    }
    return { db, cleanup, schema };
  } catch (error) { await cleanup(); throw error; }
}
