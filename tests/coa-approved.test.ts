import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildSeedPlan, type CodeDecisions } from "../src/lib/coa/seed-plan";
import { classificationSchema } from "../src/lib/coa/catalog";
import { seedAccounts, type ExistingSeedAccount } from "../src/lib/coa/seed-core";

const raw = readFileSync(new URL("../prisma/coa-source.json", import.meta.url), "utf8");
const decisionRaw = readFileSync(new URL("../prisma/coa-code-decisions.json", import.meta.url), "utf8");
const decisions = JSON.parse(decisionRaw) as CodeDecisions;
const snapshot = JSON.parse(readFileSync(new URL("../prisma/coa-approved.json", import.meta.url), "utf8"));
const plan = buildSeedPlan(raw, decisions);
const bySource = (name: string) => plan.find(row => row.sourceName === name)!;

test("committed delegated review covers all 91 accounts with 91 distinct string codes/names", () => {
  assert.equal(decisions.status, "APPROVED");
  assert.equal(decisions.reviewScope, "ALL_ACCOUNTS");
  assert.match(decisions.approvedBy!, /delegasi eksplisit pengguna/);
  assert.equal(decisions.mappings.length, 91);
  assert.ok(decisions.mappings.every(row => row.approved && row.approvedMapping));
  assert.equal(plan.length, 91);
  assert.equal(new Set(plan.map(row => row.code)).size, 91);
  assert.equal(new Set(plan.map(row => row.name.toLocaleLowerCase("id-ID"))).size, 91);
  assert.ok(plan.every(row => typeof row.code === "string" && row.reviewedAt !== null));
});
test("approved snapshot exactly matches source hash, decision hash and resolved metadata", () => {
  assert.equal(snapshot.sourceSha256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(snapshot.decisionSha256, createHash("sha256").update(decisionRaw).digest("hex"));
  assert.deepEqual(snapshot.accounts, JSON.parse(JSON.stringify(plan)));
  assert.equal(snapshot.count, 91);
});
test("the four colliding identities have distinct final codes and intact source provenance", () => {
  assert.equal(bySource("Cadangan Kerugian Piutang").code, "1122.2");
  assert.equal(bySource("Piutang Karyawan").code, "1122.1");
  assert.equal(bySource("Perlengkapan Kantor").code, "1130.1");
  assert.equal(bySource("Prepaid PPh 23").code, "1130.3");
  assert.equal(bySource("Cadangan Kerugian Piutang").sourceCode, "1122.1");
  assert.equal(bySource("Prepaid PPh 23").sourceCode, "1130.1");
  assert.equal(plan.filter(row => row.isControlAccount).length, 3);
});
test("disposal and exchange results are signed OTHER_RESULT, never operating revenue", () => {
  for (const name of ["Gain/Loss on Exchange", "Pendapatan Penjualan Aktiva"]) {
    const row = bySource(name);
    assert.equal(row.mainType, "OTHER_RESULT");
    assert.equal(row.reportGroup, "OTHER_RESULT");
    assert.equal(row.normalBalance, "CREDIT");
    assert.equal(row.isContra, false);
    assert.match(row.name, /Keuntungan.*Kerugian/);
  }
  assert.equal(bySource("PPH Pasal 25/29").reportGroup, "INCOME_TAX_EXPENSE");
  assert.equal(bySource("PPH Pasal 25/29").mainType, "EXPENSE");
  assert.match(bySource("PPH Pasal 25/29").description, /bukan otomatis/);
  assert.equal(bySource("Prepaid PPh 23").mainType, "ASSET");
  assert.equal(bySource("Hutang PPh 23").mainType, "LIABILITY");
});
test("contradictory normal balances, contra flags and control combinations are rejected", () => {
  const base = { mainType: "ASSET", reportGroup: "RECEIVABLE", normalBalance: "DEBIT", isContra: false, isControlAccount: true };
  assert.equal(classificationSchema.safeParse(base).success, true);
  for (const invalid of [
    { ...base, normalBalance: "CREDIT" },
    { ...base, isContra: true, normalBalance: "CREDIT" },
    { mainType: "EQUITY", reportGroup: "DIVIDENDS", normalBalance: "CREDIT", isContra: false, isControlAccount: false },
  ]) assert.equal(classificationSchema.safeParse(invalid).success, false);
});
test("all-account reviews cannot omit a row, duplicate names or reinterpret control accounts", () => {
  const incomplete = structuredClone(decisions); incomplete.mappings.pop();
  assert.throws(() => buildSeedPlan(raw, incomplete), /masing-masing 91 akun/);
  const duplicate = structuredClone(decisions); duplicate.mappings[1].finalName = duplicate.mappings[0].finalName;
  assert.throws(() => buildSeedPlan(raw, duplicate), /Nama final.*duplikat/);
  const control = structuredClone(decisions);
  const mapped = control.mappings.find(row => row.name === "Piutang Usaha")!.approvedMapping!;
  mapped.mainType = "LIABILITY"; mapped.reportGroup = "CURRENT_LIABILITY"; mapped.normalBalance = "CREDIT";
  assert.throws(() => buildSeedPlan(raw, control), /bertentangan dengan sifat akun/);
});
test("actual authorized plan seeds twice idempotently in unit repository without balances or journals", async () => {
  const rows: ExistingSeedAccount[] = [];
  const repo = {
    listAccounts: async () => rows, deletedSourceRows: async () => [],
    createAccount: async (data: typeof plan[number]) => {
      assert.ok(!rows.some(row => row.code === data.code));
      const row = { ...data, id: "unit-approved-" + rows.length };
      rows.push(row);
      for (const field of ["balance", "debit", "credit", "journal", "openingBalance"]) assert.ok(!(field in data));
      return row;
    },
  };
  assert.equal((await seedAccounts(plan, repo)).created, 91);
  const second = await seedAccounts(plan, repo);
  assert.equal(second.created, 0); assert.equal(second.skipped, 91); assert.equal(rows.length, 91);
});

