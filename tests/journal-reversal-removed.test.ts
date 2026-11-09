import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../src/generated/prisma/client";
import { executeJournalCommand } from "../src/lib/journal/engine";
import { executeLoanCommand } from "../src/lib/loans/engine";
import { executeTradeCommand } from "../src/lib/trade/engine";
import { createJournalSchema } from "../src/lib/journal/validation";
import { createLoanSchema, createPaymentSchema as loanPaymentSchema } from "../src/lib/loans/validation";
import { createDocumentSchema, createPaymentSchema, tradeKinds } from "../src/lib/trade/validation";

const actorId = randomUUID();
// Valid legacy payloads ensure rejection comes from the removed operation, not malformed fields.
const payload = { id: randomUUID(), date: "2037-01-02", reason: "Perintah lama", requestKey: randomUUID() };
const journalPayload = { ...payload, version: 1 };
const untouchedDatabase = new Proxy({}, { get() { assert.fail("Perintah yang dihapus tidak boleh mengakses database atau hasil idempotensi lama."); } }) as PrismaClient;

test("mesin jurnal menolak perintah REVERSE sebelum mengakses database", async () => {
  await assert.rejects(executeJournalCommand(untouchedDatabase, actorId, "REVERSE", journalPayload), z.ZodError);
});
for (const operation of ["REVERSE_LOAN", "REVERSE_PAYMENT"]) test("mesin pinjaman menolak " + operation + " sebelum mengakses database", async () => {
  await assert.rejects(executeLoanCommand(untouchedDatabase, actorId, operation, payload), z.ZodError);
});
for (const kind of tradeKinds) for (const operation of ["REVERSE_DOCUMENT", "REVERSE_PAYMENT"]) test(kind + " menolak " + operation + " sebelum mengakses database", async () => {
  await assert.rejects(executeTradeCommand(untouchedDatabase, actorId, kind, operation, payload), z.ZodError);
});
test("operasi tidak dikenal tidak dapat jatuh ke perubahan tahun atau pembayaran", async () => {
  const yearPayload = { id: payload.id, version: 1, status: "OPEN", reason: "Periksa fallback", requestKey: payload.requestKey };
  for (const operation of ["", "UNKNOWN", null, undefined]) {
    await assert.rejects(executeJournalCommand(untouchedDatabase, actorId, operation, yearPayload), z.ZodError);
    await assert.rejects(executeLoanCommand(untouchedDatabase, actorId, operation, payload), z.ZodError);
    await assert.rejects(executeTradeCommand(untouchedDatabase, actorId, "RECEIVABLE", operation, payload), z.ZodError);
  }
});
test("form pencatatan baru menolak metadata pembalik yang disisipkan", () => {
  const date = "2037-01-01", requestKey = randomUUID(), accountId = randomUUID();
  const drafts = { journalNumber:"JU/2037/001", date, requestKey, description: "Jurnal normal", lines: [{ accountId, debit: "100", credit: "0" }, { accountId: randomUUID(), debit: "0", credit: "100" }] };
  const loan = { date, requestKey, employeeName: "Karyawan", amount: "100", cashAccountId: accountId };
  const payment = { date, requestKey, amount: "10", cashAccountId: accountId };
  const inputs = [
    [createJournalSchema, drafts], [createLoanSchema, loan], [loanPaymentSchema, { ...payment, loanId: randomUUID() }],
    [createPaymentSchema, { ...payment, documentId: randomUUID() }],
    ...tradeKinds.map(kind => [createDocumentSchema(kind), { date, requestKey, partyName: "Pihak", amount: "100", counterAccountId: accountId }] as const),
  ] as const;
  for (const [schema, input] of inputs) {
    assert.equal(schema.safeParse(input).success, true);
    for (const metadata of [{ sourceType: "REVERSAL" }, { reverseOfId: randomUUID() }, { reversalEntryId: randomUUID() }]) {
      assert.equal(schema.safeParse({ ...input, ...metadata }).success, false);
    }
  }
});
