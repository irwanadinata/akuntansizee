import { readFile } from "node:fs/promises";
import { buildSeedPlan, SeedPreflightError } from "../src/lib/coa/seed-plan";
import { seedCoaInTransaction } from "../src/lib/coa/seed-database";
import { ensureSeedAdmin } from "../src/lib/auth/bootstrap-admin";
import { createDirectPrismaClient } from "../src/lib/db-core";
import { loadLocalEnv } from "../scripts/load-env";

async function main() {
  loadLocalEnv();
  const raw = await readFile(new URL("./coa-source.json", import.meta.url), "utf8");
  let decisions: unknown;
  try { decisions = JSON.parse(await readFile(new URL("./coa-code-decisions.json", import.meta.url), "utf8")); }
  catch { throw new SeedPreflightError("Berkas prisma/coa-code-decisions.json wajib tersedia dan valid; kode 1122.1 serta 1130.1 belum dapat di-seed."); }
  const plan = buildSeedPlan(raw, decisions); // Must run before env/database initialization.
  if (process.argv.includes("--check")) {
    console.info("Preflight sah: " + plan.length + " akun, 91 kode STRING unik. Tidak ada koneksi/write database.");
    return;
  }
  const db = createDirectPrismaClient();
  try {
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(726069455)::text`;
      const admin = await ensureSeedAdmin({
        findAdmin: () => tx.adminUser.findUnique({ where: { singletonKey: 1 }, select: { id: true } }),
        createAdmin: data => tx.adminUser.create({ data, select: { id: true } }),
      });
      return { ...await seedCoaInTransaction(tx, plan, admin.id), adminCreated: admin.created };
    }, { timeout: 60000, maxWait: 10000 });
    console.info(JSON.stringify({ success: true, ...result, journalsCreated: 0, openingBalancesCreated: 0 }));
  } finally { await db.$disconnect(); }
}
main().catch(error => {
  console.error(error instanceof SeedPreflightError ? error.message : "Seed gagal; seluruh transaksi dibatalkan. Periksa env Neon, migrasi dan konflik akun. Kredensial/password tidak dicetak.");
  process.exitCode = 1;
});

