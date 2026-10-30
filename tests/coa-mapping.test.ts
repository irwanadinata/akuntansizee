import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { proposeMapping } from "../src/lib/coa/mapping";
import { buildSeedPlan, createDecisionTemplate, duplicateGroups, readSource } from "../src/lib/coa/seed-plan";
import { accountInputSchema, assertCanDelete, assertCanEdit } from "../src/lib/coa/validation";

const raw = readFileSync(new URL("../prisma/coa-source.json", import.meta.url), "utf8");
const source = readSource(raw);
function named(name: string) { return source.find(row => row.name === name)!; }
test("source is exactly 91 accounts and only 1122.1 / 1130.1 are duplicated", () => {
  assert.equal(source.length, 91);
  assert.deepEqual(duplicateGroups(source).map(([code, rows]) => [code, rows.map(r => r.sourceRow)]), [["1122.1", [24, 73]], ["1130.1", [71, 79]]]);
  assert.equal(new Set(source.map(row => row.sourceCode)).size, 89);
  assert.ok(source.every(row => typeof row.sourceCode === "string"));
});
test("all 17 source types map explicitly with no fallback for unknown types", () => {
  assert.equal(new Set(source.map(a => a.sourceType)).size, 17);
  for (const row of source) assert.ok(proposeMapping(row).reportGroup);
  assert.throws(() => proposeMapping({ ...source[0], sourceType: "UNKNOWN" }), /belum memiliki mapping/);
});
test("ordinary assets, liabilities, equity, revenue, COGS and expense have correct normal balances", () => {
  for (const [name, type, normal] of [
    ["Bank Central Asia", "ASSET", "DEBIT"], ["Piutang Usaha", "ASSET", "DEBIT"],
    ["Hutang Usaha", "LIABILITY", "CREDIT"], ["Retained Earnings", "EQUITY", "CREDIT"],
    ["Pendapatan Jasa Event", "REVENUE", "CREDIT"], ["Venue Event", "COGS", "DEBIT"], ["Biaya Gaji Pegawai", "EXPENSE", "DEBIT"],
  ]) { const mapped = proposeMapping(named(name)); assert.equal(mapped.mainType, type); assert.equal(mapped.normalBalance, normal); }
});
test("contra assets, contra income and dividend preserve reviewed sign and group", () => {
  for (const name of ["Akumulasi Penyusutan Gedung", "Akumulasi Penyusutan Inventaris Kantor", "Akumulasi Penyusutan Kendaraan", "Cadangan Kerugian Piutang"]) {
    const mapped = proposeMapping(named(name)); assert.equal(mapped.mainType, "ASSET"); assert.equal(mapped.normalBalance, "CREDIT"); assert.equal(mapped.isContra, true); assert.equal(mapped.requiresReview, true);
  }
  for (const name of ["Discount", "Retur Pendapatan"]) {
    const mapped = proposeMapping(named(name)); assert.equal(mapped.reportGroup, "CONTRA_REVENUE"); assert.equal(mapped.normalBalance, "DEBIT"); assert.equal(mapped.requiresReview, true);
  }
  const dividend = proposeMapping(named("Deviden Pemegang Saham"));
  assert.equal(dividend.mainType, "EQUITY"); assert.equal(dividend.reportGroup, "DIVIDENDS"); assert.equal(dividend.normalBalance, "DEBIT");
});
test("exchange/contra/control proposals are never silently approved", () => {
  const template = createDecisionTemplate(raw);
  assert.equal(template.status, "PENDING_APPROVAL");
  assert.equal(template.codes.length, 4);
  assert.equal(template.mappings.length, 13);
  assert.ok(template.mappings.some(row => row.name === "Gain/Loss on Exchange" && row.approvedMapping === null));
  assert.ok(template.mappings.every(row => !row.approved));
  assert.throws(() => buildSeedPlan(raw, template), /1122.1:.*Cadangan.*Piutang Karyawan.*1130.1:.*Perlengkapan.*Prepaid/);
});
const valid = { code: "1112.10", name: "Akun sintetis", description: "", mainType: "ASSET", reportGroup: "CASH_BANK",
  normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true, requiresReview: false, reviewConfirmed: false, reviewReason: "" } as const;
test("account validation rejects floating codes, balances, provenance and incompatible groups", () => {
  assert.equal(accountInputSchema.parse(valid).code, "1112.10");
  for (const input of [{ ...valid, code: 1112.1 }, { ...valid, balance: "100" }, { ...valid, sourceRow: 2 }, { ...valid, reportGroup: "CAPITAL" }]) {
    assert.equal(accountInputSchema.safeParse(input).success, false);
  }
  assert.equal(accountInputSchema.safeParse({ ...valid, isContra: true }).success, false);
  assert.equal(accountInputSchema.safeParse({ ...valid, isContra: true, normalBalance: "CREDIT", isActive: false }).success, true);
});
test("delete refuses any ever-used account, and used classification stays locked", () => {
  assert.doesNotThrow(() => assertCanDelete({ usedAt: null, usageCount: 0 }));
  assert.throws(() => assertCanDelete({ usedAt: new Date(), usageCount: 0 }), /Nonaktifkan/);
  assert.throws(() => assertCanDelete({ usedAt: null, usageCount: 1 }), /Nonaktifkan/);
  const current = { ...valid, usedAt: new Date(), usageCount: 1 };
  assert.doesNotThrow(() => assertCanEdit(current, { ...valid, name: "Nama diperbarui" }));
  assert.throws(() => assertCanEdit(current, { ...valid, code: "1112.20" }), /dikunci/);
  assert.throws(() => assertCanEdit(current, { ...valid, normalBalance: "CREDIT", isContra: true, reviewConfirmed: true }), /dikunci/);
});

