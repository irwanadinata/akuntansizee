import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { rupiah, formatInteger, normalBalance } from "../src/lib/accounting/money";
import { asDate, validBusinessDate, jakartaDate } from "../src/lib/accounting/dates";
import { newJournalNumber, payloadHash, boundedCommand, isNumberCollision } from "../src/lib/journal/identity";
import { createDraftSchema, assertBalanced } from "../src/lib/journal/validation";
import { ledgerFilters } from "../src/lib/ledger/report";
import { sqlStatements } from "./integration/neon-schema";
test("Rupiah exact: digit, ribuan, batas Decimal dan saldo kontra", () => {
  assert.equal(rupiah("1.000.000"), "1000000"); assert.equal(rupiah("1000"), "1000");
  assert.equal(formatInteger("10000000000000000001"), "10.000.000.000.000.000.001");
  for (const value of ["-1", "1,5", "1.5", "1e3", "100000000000000000000"]) assert.throws(() => rupiah(value));
  assert.equal(normalBalance(-700n, "CREDIT"), 700n); assert.equal(normalBalance(700n, "CREDIT"), -700n); assert.equal(normalBalance(700n, "DEBIT"), 700n);
});
test("Tanggal kalender ketat dan tanggal nomor menggunakan WIB", () => {
  assert.equal(validBusinessDate("2028-02-29"), true); assert.equal(validBusinessDate("2027-02-29"), false);
  assert.throws(() => asDate("2026-02-30")); assert.equal(jakartaDate(new Date("2026-10-27T18:00:00Z")), "2026-10-28");
});
test("Baris satu sisi, jurnal positif seimbang, nominal tidak dibulatkan", () => {
  const lines = [{ accountId: randomUUID(), debit: "1.000.000", credit: "", description: "" }, { accountId: randomUUID(), debit: "", credit: "1000000", description: "" }];
  const parsed = createDraftSchema.parse({ date: "2026-10-28", description: "Pengujian", requestKey: randomUUID(), lines });
  assertBalanced(parsed.lines); assert.equal(parsed.lines[0].debit, "1000000");
  assert.throws(() => assertBalanced([{ debit: "1000000", credit: "0" }, { debit: "0", credit: "999999" }]));
  assert.throws(() => assertBalanced([{ debit: "0", credit: "0" }, { debit: "0", credit: "0" }]));
  for (const debit of ["", "0", "-1", "1,5"]) assert.equal(createDraftSchema.safeParse({ ...parsed, lines: [{ ...lines[0], debit }, lines[1]] }).success, false);
  assert.equal(createDraftSchema.safeParse({ ...parsed, lines: [{ ...lines[0], credit: "1" }, lines[1]] }).success, false);
});
test("Nomor acak CSPRNG dan payload hash deterministik", () => {
  const numbers = new Set(Array.from({ length: 2000 }, () => newJournalNumber(new Date("2026-10-27T18:00:00Z"))));
  assert.equal(numbers.size, 2000); assert.ok([...numbers].every(value => /^JRN-20261028-[A-F0-9]{12}$/.test(value)));
  assert.equal(payloadHash({ b: 2, a: [1, 2] }), payloadHash({ a: [1, 2], b: 2 })); assert.notEqual(payloadHash([1, 2]), payloadHash([2, 1]));
});
test("Retry dibatasi dan hanya collision nomor / serialization", async () => {
  const adapter = (table: string, fields: string[]) => ({ code: "P2002", meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", table, constraint: { fields } } } } });
  assert.equal(isNumberCollision(adapter("JournalNumber", ['"journalNumber"'])), true);
  assert.equal(isNumberCollision(adapter("JournalEntry", ["reverseOfId"])), false);
  assert.equal(isNumberCollision(adapter("Account", ["code"])), false);
  const collision = { code: "P2002", meta: { target: ["journalNumber"] } }; let calls = 0;
  assert.equal(await boundedCommand(async () => { if (++calls < 3) throw collision; return "ok"; }), "ok"); assert.equal(calls, 3);
  calls = 0; await assert.rejects(boundedCommand(async () => { calls++; throw collision; })); assert.equal(calls, 5);
  calls = 0; await assert.rejects(boundedCommand(async () => { calls++; throw { code: "P2002", meta: { target: ["year"] } }; })); assert.equal(calls, 1);
});
test("Filter tanggal/tahun, splitter migrasi menjaga badan fungsi SQL", () => {
  assert.equal(ledgerFilters.safeParse({ accountId: randomUUID(), from: "2026-10-02", to: "2026-10-01" }).success, false);
  assert.equal(sqlStatements("-- comment;\nCREATE FUNCTION x() RETURNS void AS $$ BEGIN PERFORM 1; END $$ LANGUAGE plpgsql; SELECT ';';").length, 2);
});
