import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { type Prisma } from "../../src/generated/prisma/client";
import { isolatedNeon } from "./neon-schema";
import { listAccounts,coaFilterSchema } from "../../src/lib/coa/queries";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { seedCoaInTransaction } from "../../src/lib/coa/seed-database";
import { ensureSeedAdmin } from "../../src/lib/auth/bootstrap-admin";
import { createAccountInTransaction, deleteAccountInTransaction, setAccountActiveInTransaction, editAccountInTransaction } from "../../src/lib/coa/mutations";
import { loadLocalEnv } from "../../scripts/load-env";

loadLocalEnv();
const enabled = Boolean(process.env.COA_TEST_DIRECT_URL||process.env.DIRECT_URL) && process.env.COA_TEST_CONFIRM === "CREATE_TEMP_SCHEMA";
const rollback = new Error("ROLLBACK_COA_TEST_ONLY");
async function databaseMustReject(tx: Prisma.TransactionClient, run: () => Promise<unknown>, expectedCode?: string) {
  await tx.$executeRawUnsafe("SAVEPOINT coa_expected_rejection");
  let rejected = false;
  try { await run(); } catch (error) {
    rejected = true;
    if (expectedCode) assert.equal(typeof error === "object" && error !== null && "code" in error ? error.code : null, expectedCode);
  }
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT coa_expected_rejection");
  await tx.$executeRawUnsafe("RELEASE SAVEPOINT coa_expected_rejection");
  assert.equal(rejected, true, "Database constraint/trigger harus menolak operasi.");
}
test("Neon: approved 91 COA, seed twice, unique, admin preservation, archive/delete/usage guards", {
  skip: enabled ? false : "Butuh Neon development/test dan COA_TEST_CONFIRM=CREATE_TEMP_SCHEMA.",timeout:180000,
}, async () => {
  // Real approved file only. No synthetic approval is ever used on a database.
  const raw = readFileSync(new URL("../../prisma/coa-source.json", import.meta.url), "utf8");
  const decision = JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json", import.meta.url), "utf8"));
  const plan = buildSeedPlan(raw, decision); // Pending review fails before any DB connection.
  const isolated=await isolatedNeon(process.env.COA_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
  let verified = false;
  try {
    await db.$transaction(async tx => {
      assert.equal(await tx.account.count(), 0, "Gunakan Neon test kosong, bukan development/production yang berisi data.");
      assert.equal(await tx.adminUser.count(), 0, "Database test harus kosong.");
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(726069455)::text`;
      const admin = await ensureSeedAdmin({
        findAdmin: () => tx.adminUser.findUnique({ where: { singletonKey: 1 }, select: { id: true } }),
        createAdmin: data => tx.adminUser.create({ data, select: { id: true } }),
      },{AUTH_SECRET:randomBytes(48).toString("base64url"),APP_ORIGIN:"http://localhost:3100",SEED_ADMIN_EMAIL:"coa-qa@example.invalid",SEED_ADMIN_PASSWORD:randomBytes(24).toString("base64url")+"aA1!"});
      const initialHash = (await tx.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash;
      const first = await seedCoaInTransaction(tx, plan, admin.id);
      const second = await seedCoaInTransaction(tx, plan, admin.id);
      assert.equal(first.created, 91); assert.equal(second.created, 0); assert.equal(second.skipped, 91);
      assert.equal(first.persistedSourceAccounts, 91); assert.equal(second.persistedSourceAccounts, 91);
      assert.equal(await tx.account.count(), 91);
      assert.equal(await tx.journalEntry.count(),0);assert.equal(await tx.journalLine.count(),0);assert.equal(await tx.openingJournal.count(),0);
      assert.equal(new Set((await tx.account.findMany()).map(row => row.code)).size, 91);
      const ordinary=await createAccountInTransaction(tx,admin.id,{code:"9998.3",name:"Disetujui biasa QA",description:"",mainType:"ASSET",reportGroup:"CURRENT_ASSET",normalBalance:"DEBIT",isContra:false,isControlAccount:false,isActive:true,requiresReview:false,reviewReason:"",reviewConfirmed:true});
      assert.ok(ordinary.reviewedAt);
      // Run the production list query inside the enclosing rollback-only test.
      const viewDb=new Proxy(db,{get(target,key){if(key==="$transaction")return(work:(client:Prisma.TransactionClient)=>Promise<unknown>)=>work(tx);return Reflect.get(target,key);}});
      const reviewed=await listAccounts(coaFilterSchema.parse({q:ordinary.name,review:"reviewed"}),viewDb);
      assert.equal(reviewed.accounts.length,1);assert.equal(reviewed.accounts[0].id,ordinary.id);
      await deleteAccountInTransaction(tx,admin.id,ordinary.id,ordinary.version,ordinary.code);
      const sameAdmin = await ensureSeedAdmin({ findAdmin: async () => ({ id: admin.id }), createAdmin: async () => { throw new Error("Existing admin must not reset"); } }, {});
      assert.equal(sameAdmin.created, false);
      assert.equal((await tx.adminUser.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash, initialHash);
      await databaseMustReject(tx, () => tx.account.create({ data: { ...plan[0], sourceRow: null } }), "P2002");
      await databaseMustReject(tx,()=>tx.adminUser.create({data:{email:"second-qa@example.invalid",passwordHash:"qa-disabled",singletonKey:1}}),"P2002");
      const input = { code: "9998.1", name: "Integration test only", description: "", mainType: "ASSET", reportGroup: "CASH_BANK",
        normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true, requiresReview: false, reviewReason: "", reviewConfirmed: false };
      const manual = await createAccountInTransaction(tx, admin.id, input);
      await seedCoaInTransaction(tx, plan, admin.id);
      assert.equal((await tx.account.findUniqueOrThrow({ where: { id: manual.id } })).name, input.name);
      await deleteAccountInTransaction(tx, admin.id, manual.id, manual.version, manual.code);
      assert.equal(await tx.account.findUnique({ where: { id: manual.id } }), null);
      const used = await createAccountInTransaction(tx, admin.id, { ...input, code: "9998.2" });
      await tx.accountUsage.create({ data: { accountId: used.id, sourceType: "COA_INTEGRATION_ONLY", sourceId: "no-journal-created" } });
      const marked = await tx.account.findUniqueOrThrow({ where: { id: used.id } });
      assert.ok(marked.usedAt);
      await assert.rejects(deleteAccountInTransaction(tx, admin.id, used.id, marked.version, used.code));
      await databaseMustReject(tx, () => tx.account.delete({ where: { id: used.id } }));
      await databaseMustReject(tx, () => tx.accountUsage.deleteMany({ where: { accountId: used.id } }));
      await setAccountActiveInTransaction(tx, admin.id, used.id, marked.version, false);
      assert.equal((await tx.account.findUniqueOrThrow({ where: { id: used.id } })).isActive, false);
      const source = await tx.account.findFirstOrThrow({ where: { sourceRow: plan[0].sourceRow } });
      const edited = await editAccountInTransaction(tx, admin.id, source.id, source.version, {
        code: source.code, name: "Admin edit survives", description: source.description ?? "",
        mainType: source.mainType, reportGroup: source.reportGroup, normalBalance: source.normalBalance,
        isContra: source.isContra, isControlAccount: source.isControlAccount, isActive: source.isActive,
        requiresReview: source.requiresReview, reviewReason: source.reviewReason ?? "", reviewConfirmed: Boolean(source.reviewedAt),
      });
      await seedCoaInTransaction(tx, plan, admin.id);
      assert.equal((await tx.account.findUniqueOrThrow({ where: { id: edited.id } })).name, "Admin edit survives");
      verified = true;
      throw rollback; // No test account/admin/audit/usage marker is persisted.
    }, { timeout: 120000, maxWait: 10000 });
  } catch (error) {
    if (error !== rollback) throw new Error("Uji Neon COA gagal. Periksa database test kosong, migrasi, env admin, dan keputusan yang benar-benar disahkan. Detail koneksi tidak dicetak.");
  } finally { await isolated.cleanup(); }
  assert.equal(verified, true);
});

