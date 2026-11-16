import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "../src/generated/prisma/client";
import { deleteAccountInTransaction, editAccountInTransaction, setAccountActiveInTransaction } from "../src/lib/coa/mutations";

function fixture(overrides: Record<string, unknown> = {}) {
  let row = { id: "unit-id", version: 1, code: "1112.4", name: "Akun unit", description: null,
    mainType: "ASSET", reportGroup: "CASH_BANK", normalBalance: "DEBIT", isContra: false, isControlAccount: false,
    requiresReview: false, reviewedAt: null, isActive: true, usedAt: null, sourceRow: null,
    _count: { usageRecords: 0 }, ...overrides };
  let deleted = false;
  const audit: unknown[] = [];
  const tx = {
    $queryRaw: async () => [],
    account: {
      findUnique: async () => row,
      update: async ({ data }: { data: Record<string, unknown> }) => { row = { ...row, ...data, version: row.version + 1 } as typeof row; return row; },
      delete: async () => { deleted = true; },
    },
    coaChange: { create: async (data: unknown) => { audit.push(data); } },
  } as unknown as Prisma.TransactionClient;
  return { tx, get row() { return row; }, get deleted() { return deleted; }, audit };
}
test("archive preserves account identity and usage history; no deletion occurs", async () => {
  const usedAt = new Date();
  const unit = fixture({ usedAt, _count: { usageRecords: 1 } });
  await setAccountActiveInTransaction(unit.tx, "admin", "unit-id", 1, false);
  assert.equal(unit.row.isActive, false); assert.equal(unit.row.usedAt, usedAt);
  assert.equal(unit.row.code, "1112.4"); assert.equal(unit.deleted, false); assert.equal(unit.audit.length, 1);
});
test("pending review cannot be activated, and stale versions cannot change an account", async () => {
  const unit = fixture({ isActive: false, requiresReview: true });
  await assert.rejects(setAccountActiveInTransaction(unit.tx, "admin", "unit-id", 1, true), /setujui/);
  await assert.rejects(setAccountActiveInTransaction(unit.tx, "admin", "unit-id", 2, false), /sudah berubah/);
  assert.equal(unit.audit.length, 0);
});
test("only an unused account with matching confirmation/version is deleted and audited", async () => {
  const unit = fixture();
  await assert.rejects(deleteAccountInTransaction(unit.tx, "admin", "unit-id", 1, "wrong-code"), /Konfirmasi/);
  assert.equal(unit.deleted, false);
  await deleteAccountInTransaction(unit.tx, "admin", "unit-id", 1, "1112.4");
  assert.equal(unit.deleted, true); assert.equal(unit.audit.length, 1);
  const used = fixture({ usedAt: new Date() });
  await assert.rejects(deleteAccountInTransaction(used.tx, "admin", "unit-id", 1, "1112.4"), /Nonaktifkan/);
  assert.equal(used.deleted, false);
});
test("editing an unused account updates metadata without any balance field", async () => {
  const unit = fixture();
  await editAccountInTransaction(unit.tx, "admin", "unit-id", 1, {
    code: "1112.5", name: "Nama diubah admin", description: "Keterangan", mainType: "ASSET", reportGroup: "CASH_BANK",
    normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true,
    requiresReview: false, reviewReason: "", reviewConfirmed: false,
  });
  assert.equal(unit.row.code, "1112.5"); assert.equal(unit.row.name, "Nama diubah admin");
  assert.equal(unit.row.version, 2); assert.ok(!("balance" in unit.row));
});

test("editing an approved control account preserves its role, inactive status and original approval", async () => {
  const approvedAt = new Date("2026-01-02T00:00:00Z");
  const unit = fixture({ isControlAccount: true, requiresReview: true, isActive: false, reviewedAt: approvedAt });
  await editAccountInTransaction(unit.tx, "admin", "unit-id", 1, {
    code: "1112.4", name: "Nama akun diperbaiki", description: "Keterangan baru", mainType: "ASSET", reportGroup: "CASH_BANK",
    normalBalance: "DEBIT", isContra: false, isControlAccount: true, isActive: false,
    requiresReview: true, reviewReason: "Persetujuan awal", reviewConfirmed: true,
  });
  assert.equal(unit.row.isControlAccount, true); assert.equal(unit.row.isActive, false);
  assert.equal(unit.row.reviewedAt, approvedAt); assert.equal(unit.audit.length, 1);
});

test("changing classification does not carry an old approval into the new classification", async () => {
  const unit = fixture({ reviewedAt: new Date("2026-01-02T00:00:00Z") });
  await editAccountInTransaction(unit.tx, "admin", "unit-id", 1, {
    code: "1112.4", name: "Beban kantor", description: "", mainType: "EXPENSE", reportGroup: "OPERATING_EXPENSE",
    normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true,
    requiresReview: false, reviewReason: "", reviewConfirmed: false,
  });
  assert.equal(unit.row.mainType, "EXPENSE"); assert.equal(unit.row.reviewedAt, null);
});

test("a newly required review records the new confirmation rather than reusing an ordinary approval", async () => {
  const oldApproval = new Date("2026-01-02T00:00:00Z");
  const unit = fixture({ reviewedAt: oldApproval });
  await editAccountInTransaction(unit.tx, "admin", "unit-id", 1, {
    code: "1112.4", name: "Transitory Account", description: "", mainType: "ASSET", reportGroup: "CASH_BANK",
    normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true,
    requiresReview: false, reviewReason: "", reviewConfirmed: true,
  });
  assert.equal(unit.row.requiresReview, true); assert.ok(unit.row.reviewedAt);
  assert.notEqual(unit.row.reviewedAt, oldApproval);
});

