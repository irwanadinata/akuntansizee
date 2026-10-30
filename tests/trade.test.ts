import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  counterAccountAllowed, createDocumentSchema, createPaymentSchema, documentFields, paymentFields,
  reverseTradeSchema, TRADE_CONTROL_CODES, tradeKinds,
} from "../src/lib/trade/validation";
import { tradeFilters } from "../src/lib/trade/queries";
import { boundedCommand, isNumberCollision, newPublicNumber } from "../src/lib/journal/identity";

test("piutang/utang memakai kontrol COA sah yang terpisah; pihak tetap atribut dokumen", () => {
  const approved = JSON.parse(readFileSync(new URL("../prisma/coa-approved.json", import.meta.url), "utf8"));
  assert.deepEqual([...tradeKinds], ["RECEIVABLE", "PAYABLE"]);
  assert.deepEqual(TRADE_CONTROL_CODES, { RECEIVABLE: "1121.1", PAYABLE: "2110.1" });
  for (const kind of tradeKinds) {
    const account = approved.accounts.find((value: { code: string }) => value.code === TRADE_CONTROL_CODES[kind]);
    assert.ok(account); assert.equal(account.isControlAccount, true); assert.equal(account.isContra, false);
    assert.equal(account.mainType, kind === "RECEIVABLE" ? "ASSET" : "LIABILITY");
    assert.equal(account.normalBalance, kind === "RECEIVABLE" ? "DEBIT" : "CREDIT");
    const parsed = createDocumentSchema(kind).parse({ partyName: " A ", date: "2037-01-01", amount: "5.000.000", counterAccountId: randomUUID(), requestKey: randomUUID() });
    assert.equal(parsed.partyName, "A"); assert.equal(parsed.amount, "5000000");
    assert.equal(parsed.externalReference, ""); assert.equal(parsed.notes, ""); assert.equal(parsed.dueDate, "");
  }
});

test("supplier menerima Beban/HPP/Aset debit; customer hanya pendapatan kredit biasa", () => {
  const base = { mainType: "EXPENSE", reportGroup: "OPERATING_EXPENSE", normalBalance: "DEBIT", isContra: false, isControlAccount: false };
  for (const mainType of ["EXPENSE", "COGS", "ASSET"]) assert.equal(counterAccountAllowed("PAYABLE", { ...base, mainType }), true);
  for (const account of [
    { ...base, mainType: "REVENUE", normalBalance: "CREDIT" }, { ...base, mainType: "LIABILITY" },
    { ...base, mainType: "ASSET", reportGroup: "CASH_BANK" }, { ...base, isControlAccount: true },
    { ...base, isContra: true }, { ...base, normalBalance: "CREDIT" },
  ]) assert.equal(counterAccountAllowed("PAYABLE", account), false);
  const revenue = { ...base, mainType: "REVENUE", normalBalance: "CREDIT" };
  assert.equal(counterAccountAllowed("RECEIVABLE", revenue), true);
  for (const account of [base, { ...revenue, normalBalance: "DEBIT" }, { ...revenue, isContra: true }, { ...revenue, isControlAccount: true }]) {
    assert.equal(counterAccountAllowed("RECEIVABLE", account), false);
  }
});

test("nominal dokumen/pembayaran exact hingga Decimal20; nol/pecahan/overflow ditolak", () => {
  for (const kind of tradeKinds) {
    const input = { partyName: "Pihak sintetis", date: "2037-01-01", amount: "1000", counterAccountId: randomUUID(), requestKey: randomUUID() };
    const payment = { documentId: randomUUID(), date: input.date, amount: input.amount, cashAccountId: randomUUID(), requestKey: randomUUID() };
    for (const amount of ["", " ", "0", "-1", "1,5", "1.5", "1e3", "100000000000000000000"]) {
      assert.equal(createDocumentSchema(kind).safeParse({ ...input, amount }).success, false, `${kind}: ${amount}`);
      assert.equal(createPaymentSchema.safeParse({ ...payment, amount }).success, false, `payment: ${amount}`);
    }
    for (const amount of ["10000000000000001", "99999999999999999999"]) {
      assert.equal(createDocumentSchema(kind).parse({ ...input, amount }).amount, amount);
      assert.equal(createPaymentSchema.parse({ ...payment, amount }).amount, amount);
    }
    assert.equal(createPaymentSchema.parse({ ...payment, amount: "1.500.000" }).amount, "1500000");
  }
});

test("tanggal, relasi, panjang field dan nomor internal manual divalidasi pada boundary", () => {
  for (const kind of tradeKinds) {
    const fields = { partyName: "Pihak sintetis", date: "2037-01-01", amount: "100", counterAccountId: randomUUID() };
    assert.equal(documentFields(kind).safeParse(fields).success, true);
    const input = { ...fields, requestKey: randomUUID() };
    for (const extra of [
      { documentNumber: "PIU-manual" }, { internalNumber: "UTG-manual" }, { journalNumber: "JRN-manual" },
      { controlAccountId: randomUUID() }, { balance: "50" }, { kind: "PAYABLE" }, { partyName: " " },
      { date: "2037-01-02", dueDate: "2037-01-01" }, { date: "2037-02-29" }, { date: "2037-02-30" },
      { counterAccountId: "invalid" }, { requestKey: "invalid" }, { externalReference: "X".repeat(101) },
    ]) assert.equal(createDocumentSchema(kind).safeParse({ ...input, ...extra }).success, false, JSON.stringify(extra));
    assert.equal(createDocumentSchema(kind).parse({ ...input, dueDate: "2037-01-01", externalReference: " INV/SHARED " }).externalReference, "INV/SHARED");
  }
  const fields = { date: "2037-01-02", amount: "10", cashAccountId: randomUUID() };
  assert.equal(paymentFields.safeParse(fields).success, true);
  const payment = { ...fields, documentId: randomUUID(), requestKey: randomUUID() };
  for (const extra of [{ paymentNumber: "BYC-manual" }, { journalNumber: "JRN-manual" }, { remaining: "100" }, { documentId: "invalid" }]) {
    assert.equal(createPaymentSchema.safeParse({ ...payment, ...extra }).success, false);
  }
  const reversal = { id: randomUUID(), date: "2038-01-01", reason: "Koreksi sintetis", requestKey: randomUUID() };
  assert.equal(reverseTradeSchema.safeParse(reversal).success, true);
  for (const extra of [{ reason: " " }, { id: "invalid" }, { date: "2038-02-30" }, { journalNumber: "manual" }]) {
    assert.equal(reverseTradeSchema.safeParse({ ...reversal, ...extra }).success, false);
  }
});

test("PIU/UTG/BYC/BYS memakai tanggal pembuatan WIB dan nomor CSPRNG unik", () => {
  const now = new Date("2037-12-31T18:00:00Z");
  for (const prefix of ["PIU", "UTG", "BYC", "BYS"] as const) {
    const values = Array.from({ length: 1000 }, () => newPublicNumber(prefix, now));
    assert.equal(new Set(values).size, values.length);
    assert.ok(values.every(value => new RegExp(`^${prefix}-20380101-[A-F0-9]{12}$`).test(value)));
  }
});

test("retry terbatas khusus nomor; FK, idempotency, source journal dan kode COA bukan collision nomor", async () => {
  const collision = (table: string, field: string) => ({ code: "P2002", meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", table, constraint: { fields: [`"${field}"`] } } } } });
  for (const [table, field] of [["TradeDocument", "documentNumber"], ["TradePayment", "paymentNumber"], ["JournalNumber", "journalNumber"]]) {
    assert.equal(isNumberCollision(collision(table, field)), true);
    let attempts = 0;
    await assert.rejects(boundedCommand(async () => { attempts++; throw collision(table, field); }));
    assert.equal(attempts, 5);
  }
  for (const error of [collision("TradeDocument", "journalEntryId"), collision("TradePayment", "reversalEntryId"), collision("TradeRequest", "requestKey"), collision("Account", "code"), { code: "P2003" }, new Error("synthetic failure")]) {
    assert.equal(isNumberCollision(error), false);
    let attempts = 0;
    await assert.rejects(boundedCommand(async () => { attempts++; throw error; }));
    assert.equal(attempts, 1);
  }
});

test("filter nama/nomor/tahun/status termasuk parsial dan pagination divalidasi", () => {
  assert.deepEqual(tradeFilters.parse({ q: " Customer A ", year: "2037", status: "partial", page: "2" }), { q: "Customer A", year: "2037", status: "partial", page: 2 });
  for (const status of ["all", "unpaid", "partial", "paid", "cancelled"]) assert.equal(tradeFilters.parse({ status }).status, status);
  assert.equal(tradeFilters.parse({ q: "%_" }).q, "%_");
  assert.equal(tradeFilters.parse({ status: "unknown", year: "all", page: "-1" }).status, "all");
  assert.equal(tradeFilters.parse({ page: "100001" }).page, 1);
});
