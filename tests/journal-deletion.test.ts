import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { deleteJournalSchema } from "../src/lib/journal/validation";
import { journalDeletionBlock } from "../src/lib/journal/deletion";
import { executeJournalCommand } from "../src/lib/journal/engine";

const payload = { id: randomUUID(), version: 2, requestKey: randomUUID(), reason: "  Salah pencatatan  " };

test("hapus jurnal memerlukan identitas, versi, kunci permintaan dan alasan", () => {
  assert.equal(deleteJournalSchema.parse(payload).reason, "Salah pencatatan");
  for (const extra of [{ id: "bad" }, { version: 0 }, { version: 1.5 }, { requestKey: "bad" }, { reason: "  " }, { reason: "ab" }, { reason: "x".repeat(1001) }, { lines: [] }, { sourceType: "MANUAL" }]) {
    assert.equal(deleteJournalSchema.safeParse({ ...payload, ...extra }).success, false);
  }
});

test("payload hapus yang tidak sah ditolak sebelum mengakses database", async () => {
  const db = new Proxy({}, { get() { assert.fail("Payload tidak sah tidak boleh mengakses database"); } }) as PrismaClient;
  for (const extra of [{ reason: "" }, { version: 0 }, { id: "bad" }, { requestKey: undefined }]) {
    await assert.rejects(executeJournalCommand(db, randomUUID(), "DELETE", { ...payload, ...extra }));
  }
});

test("jurnal manual terbuka termasuk draf lama dapat dihapus", () => {
  for (const status of ["POSTED", "DRAFT"]) assert.equal(journalDeletionBlock({ sourceType: "MANUAL", status, openingJournal: null, fiscalYear: { status: "OPEN" } }), null);
});

test("jurnal otomatis, pembukaan, pembalik dan periode terkunci dilindungi", () => {
  const base = { sourceType: "MANUAL", status: "POSTED" };
  for (const sourceType of ["LOAN", "LOAN_PAYMENT", "TRADE_DOCUMENT", "TRADE_PAYMENT", "REVERSAL"]) assert.ok(journalDeletionBlock({ ...base, sourceType }));
  assert.match(journalDeletionBlock({ ...base, openingJournal: { id: randomUUID() } })!, /saldo pembukaan/);
  assert.match(journalDeletionBlock({ ...base, status: "REVERSED" })!, /pembalik/);
  assert.match(journalDeletionBlock({ ...base, fiscalYear: { status: "LOCKED" } })!, /terkunci/);
});
