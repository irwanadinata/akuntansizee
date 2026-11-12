import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Prisma } from "../../src/generated/prisma/client";
import { loadLocalEnv } from "../../scripts/load-env";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { audit, executeJournalCommand, journalSnapshot } from "../../src/lib/journal/engine";
import { journalList } from "../../src/lib/journal/queries";
import { executeLoanCommand } from "../../src/lib/loans/engine";
import { executeTradeCommand } from "../../src/lib/trade/engine";
import { previewOpening, postOpening } from "../../src/lib/opening/engine";
import { ledgerReport } from "../../src/lib/ledger/report";
import { financialReport } from "../../src/lib/reports/engine";
import { isolatedNeon } from "./neon-schema";
import { seedLegacyUnposted } from "../fixtures/legacy-unposted";
import { seedLegacyReversal } from "../fixtures/legacy-reversal";

loadLocalEnv();
const enabled = process.env.JOURNAL_TEST_CONFIRM === "CREATE_TEMP_SCHEMA" && Boolean(process.env.JOURNAL_TEST_DIRECT_URL || process.env.DIRECT_URL);

test("PostgreSQL: hapus jurnal dengan audit, saldo exact dan perlindungan relasi", { skip: enabled ? false : "Perlu target uji jurnal terisolasi.", timeout: 360000 }, async t => {
  const isolated = await isolatedNeon(process.env.JOURNAL_TEST_DIRECT_URL || process.env.DIRECT_URL!), { db } = isolated;
  try {
    const admin = await db.adminUser.create({ data: { email: "journal-delete@example.invalid", passwordHash: "disabled-test-only" } });
    const plan = buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json", import.meta.url), "utf8"), JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json", import.meta.url), "utf8")));
    await db.account.createMany({ data: plan });
    const all = await db.account.findMany(), cash = all.find(a => a.reportGroup === "CASH_BANK")!, income = all.find(a => a.mainType === "REVENUE" && !a.isContra)!, expense = all.find(a => a.mainType === "EXPENSE" && !a.isContra)!, capital = all.find(a => a.reportGroup === "CAPITAL")!;
    const run = (operation: string, value: object) => executeJournalCommand(db, admin.id, operation, { requestKey: randomUUID(), ...value });
    const lines = (amount = "1000") => [{ accountId: cash.id, debit: amount, credit: "0", description: "Kas sintetis" }, { accountId: income.id, debit: "0", credit: amount, description: "Pendapatan sintetis" }];
    const create = (amount = "1000") => run("CREATE", { journalNumber: "DEL/" + randomUUID(), date: "2037-02-01", description: "Jurnal uji penghapusan", lines: lines(amount) });
    const stored = (id: string) => db.journalEntry.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    const remove = (entry: { id: string; version: number }, extra = {}) => run("DELETE", { id: entry.id, version: entry.version, reason: "Salah pencatatan sintetis", ...extra });
    const state = async () => JSON.stringify({ entries: await db.journalEntry.findMany({ orderBy: { id: "asc" }, include: { lines: { orderBy: { lineNo: "asc" } } } }), audits: await db.auditEvent.count(), requests: await db.journalRequest.count(), usage: await db.accountUsage.count(), numbers: await db.journalNumber.count() });
    const deletionDetails = async (tx: Prisma.TransactionClient, row: Awaited<ReturnType<typeof stored>>) => {
      const [transaction] = await tx.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`;
      return { transactionId: transaction.id, reason: "Audit uji penghapusan", before: journalSnapshot(row), status: row.status, postingStatus: row.postingStatus, fiscalYearId: row.fiscalYearId };
    };
    const addDeleteAudit = async (tx: Prisma.TransactionClient, row: Awaited<ReturnType<typeof stored>>) => audit(tx, admin.id, row.id, "DELETED", await deletionDetails(tx, row));
    const ledger = () => ledgerReport(db, { accountId: cash.id, from: "2037-01-01", to: "2037-12-31" });
    const report = () => financialReport(db, { year: 2037, from: "2037-01-01", to: "2037-12-31" });
    await run("CREATE_YEAR", { year: 2037 });

    await t.test("hapus terposting menghilangkan seluruh baris serta pengaruh Buku Besar dan laporan", async () => {
      const amount = "10000000000000001", entry = await create(amount), before = await stored(entry.id);
      assert.equal((await ledger()).closing, amount);
      assert.equal((await report()).balance.totalAssets, amount);
      const [first, retry] = await Promise.all([remove(entry, { requestKey: entry.id }), remove(entry, { requestKey: entry.id })]);
      assert.deepEqual(first, retry); assert.equal(first.status, "DELETED");
      assert.equal(await db.journalEntry.findUnique({ where: { id: entry.id } }), null);
      assert.equal(await db.journalLine.count({ where: { entryId: entry.id } }), 0);
      assert.equal((await ledger()).closing, "0"); assert.equal((await report()).balance.totalAssets, "0");
      assert.equal((await journalList(db, { q: "", status: "", year: "2037", page: 1 })).total, 0);
      const events = await db.auditEvent.findMany({ where: { entityId: entry.id, action: "DELETED" } });
      assert.equal(events.length, 1); assert.deepEqual((events[0].details as { before: unknown }).before, journalSnapshot(before));
      assert.equal(await db.journalRequest.count({ where: { operation: "DELETE", requestKey: entry.id } }), 1);
      assert.equal(await db.accountUsage.count({ where: { sourceId: entry.id } }), 2);
      assert.equal(await db.journalNumber.count({ where: { journalNumber: entry.journalNumber! } }), 1);
      await assert.rejects(run("CREATE", { journalNumber: entry.journalNumber, date: "2037-02-01", description: "Nomor tidak boleh diulang", lines: lines() }), /sudah pernah digunakan/);
      await assert.rejects(remove(entry, { requestKey: entry.id, reason: "Isi berubah" }), /isi berbeda/);
      await assert.rejects(remove(entry), /tidak ditemukan/);
      await assert.rejects(db.auditEvent.deleteMany({ where: { entityId: entry.id } }));
    });

    await t.test("DB menolak delete tanpa audit, audit palsu, audit tanpa delete, dan delete sebagian", async () => {
      const entry = await create(), row = await stored(entry.id), before = await state();
      await assert.rejects(db.$transaction(tx => tx.journalEntry.delete({ where: { id: entry.id } })), /audit/);
      for (const extra of [{ transactionId: "0" }, { before: {} }, { reason: "" }, { status: "DRAFT" }, { fiscalYearId: randomUUID() }]) {
        await assert.rejects(db.$transaction(async tx => { await audit(tx, admin.id, entry.id, "DELETED", { ...await deletionDetails(tx, row), ...extra }); await tx.journalEntry.delete({ where: { id: entry.id } }); }));
      }
      await assert.rejects(db.$transaction(async tx => { await addDeleteAudit(tx, row); }), /bersama penghapusan/);
      await assert.rejects(db.$transaction(async tx => { await addDeleteAudit(tx, row); await tx.journalLine.deleteMany({ where: { entryId: entry.id } }); }));
      assert.equal(await state(), before);
      await remove(entry);
    });

    await t.test("kegagalan setelah delete mengembalikan jurnal, baris, audit dan saldo", async () => {
      const entry = await create(), row = await stored(entry.id), before = await state();
      await assert.rejects(db.$transaction(async tx => { await addDeleteAudit(tx, row); await tx.journalEntry.delete({ where: { id: entry.id } }); throw Error("Simulasi kegagalan transaksi"); }), /Simulasi/);
      assert.equal(await state(), before); assert.equal((await ledger()).closing, "1000");
      await remove(entry);
    });

    await t.test("versi basi ditolak; dua delete dengan kunci berbeda hanya berhasil sekali", async () => {
      const entry = await create(), before = await state();
      await assert.rejects(remove(entry, { version: entry.version - 1 }), /sudah berubah/); assert.equal(await state(), before);
      const outcomes = await Promise.allSettled([remove(entry), remove(entry)]);
      assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter(value => value.status === "rejected").length, 1);
      assert.equal(await db.auditEvent.count({ where: { entityId: entry.id, action: "DELETED" } }), 1);
    });

    await t.test("edit dan delete serentak tidak menimpa versi satu sama lain", async () => {
      const entry = await create();
      const outcomes = await Promise.allSettled([remove(entry), run("UPDATE", { id: entry.id, version: entry.version, journalNumber: entry.journalNumber, date: "2037-02-01", description: "Koreksi serentak", lines: lines("500"), reason: "Koreksi bukti" })]);
      assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
      const remaining = await db.journalEntry.findUnique({ where: { id: entry.id } });
      if (remaining) { assert.equal(remaining.version, entry.version + 1); await remove(remaining); }
      assert.equal((await ledger()).closing, "0");
    });

    await t.test("tahun terkunci menolak delete pada layanan dan database tanpa perubahan sebagian", async () => {
      const entry = await create(), row = await stored(entry.id), fiscal = await db.fiscalYear.findUniqueOrThrow({ where: { year: 2037 } });
      const locked = await run("SET_YEAR_STATUS", { id: fiscal.id, version: fiscal.version, status: "LOCKED", reason: "Kunci tahun uji" });
      const before = await state(); await assert.rejects(remove(entry), /terkunci/);
      await assert.rejects(db.$transaction(async tx => { await addDeleteAudit(tx, row); await tx.journalEntry.delete({ where: { id: entry.id } }); }), /terkunci/);
      assert.equal(await state(), before);
      await run("SET_YEAR_STATUS", { id: fiscal.id, version: locked.version, status: "OPEN", reason: "Buka kembali uji" }); await remove(entry);
    });

    await t.test("draf lama dan jurnal dengan akun nonaktif tetap dapat dibersihkan", async () => {
      const legacy = await seedLegacyUnposted(db, admin.id, "2037-02-01", lines()); await remove(legacy);
      const posted = await create(); await db.account.update({ where: { id: cash.id }, data: { isActive: false, version: { increment: 1 } } });
      await remove(posted); assert.equal((await ledger()).closing, "0");
      await db.account.update({ where: { id: cash.id }, data: { isActive: true, version: { increment: 1 } } });
    });

    await t.test("saldo pembukaan dan pasangan pembalik dilindungi pada layanan dan database", async () => {
      const fiscal = await db.fiscalYear.findUniqueOrThrow({ where: { year: 2037 } });
      const input = { fiscalYearId: fiscal.id, cutoverDate: "2037-01-01", verificationNote: "Saldo awal sintetis diverifikasi", lines: [{ accountId: cash.id, side: "DEBIT", amount: "10" }, { accountId: capital.id, side: "CREDIT", amount: "10" }] };
      const preview = await previewOpening(db, input), opening = await postOpening(db, admin.id, { ...preview.input, previewHash: preview.previewHash, confirmed: true, requestKey: randomUUID() });
      const original = await create("19"), reversal = await seedLegacyReversal(db, admin.id, original.id, "2037-02-02");
      for (const id of [opening.id, original.id, reversal.id]) {
        const row = await stored(id), before = await state(); await assert.rejects(remove(row), /pembukaan|pembalik/);
        await assert.rejects(db.$transaction(async tx => { await addDeleteAudit(tx, row); await tx.journalEntry.delete({ where: { id } }); }));
        assert.equal(await state(), before);
      }
      assert.equal(await db.openingJournal.count(), 1);
    });

    await t.test("jurnal pinjaman, tagihan dan pembayaran tidak dapat dihapus terpisah", async () => {
      const loan = await executeLoanCommand(db, admin.id, "CREATE_LOAN", { employeeName: "Karyawan sintetis", date: "2037-03-01", amount: "100", cashAccountId: cash.id, requestKey: randomUUID() });
      const installment = await executeLoanCommand(db, admin.id, "CREATE_PAYMENT", { loanId: loan.id, date: "2037-03-02", amount: "10", cashAccountId: cash.id, requestKey: randomUUID() });
      const ids = [loan.journalId, installment.journalId];
      for (const kind of ["RECEIVABLE", "PAYABLE"] as const) {
        const document = await executeTradeCommand(db, admin.id, kind, "CREATE_DOCUMENT", { partyName: "Pihak sintetis", date: "2037-03-01", amount: "100", counterAccountId: kind === "RECEIVABLE" ? income.id : expense.id, requestKey: randomUUID() });
        const payment = await executeTradeCommand(db, admin.id, kind, "CREATE_PAYMENT", { documentId: document.id, date: "2037-03-02", amount: "10", cashAccountId: cash.id, requestKey: randomUUID() });
        ids.push(document.journalId, payment.journalId);
      }
      for (const id of ids) {
        const row = await stored(id), before = await state(); await assert.rejects(remove(row), /Jurnal otomatis/);
        await assert.rejects(db.$transaction(async tx => { await addDeleteAudit(tx, row); await tx.journalEntry.delete({ where: { id } }); }));
        assert.equal(await state(), before);
      }
      const financial = await report(); assert.ok(financial.diagnostics.reconciliations.every(row => row.difference === "0"));
    });
  } finally { await isolated.cleanup(); }
});
