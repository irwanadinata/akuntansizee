import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSeedPlan, createDecisionTemplate, type CodeDecisions, type SeedAccount } from "../src/lib/coa/seed-plan";
import { seedAccounts, type ExistingSeedAccount, type SeedRepository } from "../src/lib/coa/seed-core";
import { ensureSeedAdmin } from "../src/lib/auth/bootstrap-admin";

const raw = readFileSync(new URL("../prisma/coa-source.json", import.meta.url), "utf8");
function approvedFixture(): CodeDecisions {
  // UNIT-TEST SIMULATION ONLY. Never writes approval into the repository or a DB.
  const result = createDecisionTemplate(raw);
  result.status = "APPROVED"; result.approvedBy = "UNIT_TEST_ONLY"; result.approvedAt = "2026-10-28T00:00:00Z";
  for (const item of result.codes) { item.finalCode = item.proposedCode; item.approved = true; }
  for (const item of result.mappings) { item.approvedMapping = item.proposedMapping; item.approved = true; }
  return result;
}
function memoryRepository(initial: ExistingSeedAccount[] = [], deleted: number[] = []) {
  const rows = [...initial]; const writes: SeedAccount[] = [];
  const repository: SeedRepository = {
    listAccounts: async () => rows, deletedSourceRows: async () => deleted,
    createAccount: async data => {
      assert.ok(!rows.some(row => row.code === data.code)); // Unit model, not proof of a live DB constraint.
      const row = { ...data, id: "unit-" + rows.length }; rows.push(row); writes.push(data); return row;
    },
  };
  return { repository, rows, writes };
}
test("approved simulation seeds 91 exactly once; second run skips all, no monetary fields exist", async () => {
  const fixture = approvedFixture();
  const plan = buildSeedPlan(raw, fixture);
  assert.equal(plan.length, 91); assert.equal(new Set(plan.map(row => row.code)).size, 91);
  const store = memoryRepository();
  assert.deepEqual(await seedAccounts(plan, store.repository), { created: 91, skipped: 0, preservedDeleted: 0, sourceAccounts: 91 });
  assert.deepEqual(await seedAccounts(plan, store.repository), { created: 0, skipped: 91, preservedDeleted: 0, sourceAccounts: 91 });
  assert.equal(store.rows.length, 91); assert.equal(store.writes.length, 91);
  for (const row of store.writes) for (const key of ["balance", "debit", "credit", "journal", "openingBalance"]) assert.ok(!(key in row));
});
test("approval and all final code/review gates fail before any repository is used", () => {
  const fixture = approvedFixture();
  fixture.codes[0].approved = false;
  assert.throws(() => buildSeedPlan(raw, fixture), /Kode final/);
  const same = approvedFixture(); same.codes[0].finalCode = "1122.1";
  assert.throws(() => buildSeedPlan(raw, same), /masih duplikat/);
  const wrong = approvedFixture(); wrong.codes[0].sourceCode = "wrong";
  assert.throws(() => buildSeedPlan(raw, wrong), /Identitas/);
  const review = approvedFixture(); review.mappings.find(row => row.name === "Gain/Loss on Exchange")!.approved = false;
  assert.throws(() => buildSeedPlan(raw, review), /Gain.Loss/);
  const hash = approvedFixture(); hash.sourceSha256 = "0".repeat(64);
  assert.throws(() => buildSeedPlan(raw, hash), /SHA-256/);
});
test("admin-created and edited accounts are preserved, including source account code changes", async () => {
  const plan = buildSeedPlan(raw, approvedFixture());
  const manual = { id: "manual", code: "9999.1", sourceRow: null, sourceCode: null, sourceName: null };
  const edited = { id: "edited", code: "9999.2", sourceRow: plan[0].sourceRow, sourceCode: plan[0].sourceCode, sourceName: plan[0].sourceName };
  const before = structuredClone([manual, edited]);
  const store = memoryRepository([manual, edited]);
  const result = await seedAccounts(plan, store.repository);
  assert.equal(result.created, 90); assert.equal(result.skipped, 1);
  assert.deepEqual(store.rows.slice(0, 2), before);
});
test("a late manual-code collision rejects the whole plan before creating an earlier account", async () => {
  const plan = buildSeedPlan(raw, approvedFixture());
  const store = memoryRepository([{ id: "manual", code: plan.at(-1)!.code, sourceRow: null, sourceCode: null, sourceName: null }]);
  await assert.rejects(seedAccounts(plan, store.repository), /tidak menimpa/);
  assert.equal(store.writes.length, 0);
});
test("admin deletion tombstones prevent re-seed from recreating deliberately deleted source rows", async () => {
  const plan = buildSeedPlan(raw, approvedFixture());
  const store = memoryRepository([], [plan[0].sourceRow]);
  const result = await seedAccounts(plan, store.repository);
  assert.equal(result.created, 90); assert.equal(result.preservedDeleted, 1);
});
test("seed admin never resets existing password or requires replacement credentials for existing admin", async () => {
  let created = false;
  const result = await ensureSeedAdmin({ findAdmin: async () => ({ id: "existing" }), createAdmin: async () => { created = true; return { id: "new" }; } }, {});
  assert.deepEqual(result, { id: "existing", created: false }); assert.equal(created, false);
  await assert.rejects(ensureSeedAdmin({ findAdmin: async () => null, createAdmin: async () => { throw new Error("must not run"); } }, {}), /AUTH_SECRET/);
});
test("first admin is validated and hashed from env, never persisted as a plaintext password", async () => {
  const password = "Synthetic-Only!78q";
  const result = await ensureSeedAdmin({
    findAdmin: async () => null,
    createAdmin: async data => { assert.notEqual(data.passwordHash, password); assert.match(data.passwordHash, /^\$2[ab]\$12\$/); assert.equal(data.email, "admin@unit.test"); return { id: "new" }; },
  }, { SEED_ADMIN_EMAIL: "ADMIN@UNIT.TEST", SEED_ADMIN_PASSWORD: password, AUTH_SECRET: "unit-test-only-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789", APP_ORIGIN: "http://localhost:3000", NODE_ENV: "test" });
  assert.deepEqual(result, { id: "new", created: true });
});

