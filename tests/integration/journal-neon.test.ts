import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "../../scripts/load-env";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { executeJournalCommand, type CommandResult, type JournalOperation, type JournalDependencies } from "../../src/lib/journal/engine";
import { ledgerReport } from "../../src/lib/ledger/report";
import { isolatedNeon } from "./neon-schema";
loadLocalEnv();
const enabled = process.env.JOURNAL_TEST_CONFIRM === "CREATE_TEMP_SCHEMA" && Boolean(process.env.JOURNAL_TEST_DIRECT_URL || process.env.DIRECT_URL);
test("Neon PostgreSQL: mesin jurnal dan buku besar pada schema sementara", { skip: enabled ? false : "Butuh DIRECT_URL Neon test dan JOURNAL_TEST_CONFIRM=CREATE_TEMP_SCHEMA.", timeout: 360000 }, async t => {
  const isolated = await isolatedNeon(process.env.JOURNAL_TEST_DIRECT_URL || process.env.DIRECT_URL!);
  const { db } = isolated;
  try {
    const admin = await db.adminUser.create({ data: { email: "journal-test@example.invalid", passwordHash: "test-only-disabled-" + randomUUID() } });
    const plan = buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json", import.meta.url), "utf8"), JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json", import.meta.url), "utf8")));
    await db.account.createMany({ data: plan });
    assert.equal(await db.account.count(), 91); assert.equal(await db.journalEntry.count(), 0);
    const all = await db.account.findMany(), cash = all.find(a => a.reportGroup === "CASH_BANK")!, income = all.find(a => a.mainType === "REVENUE" && !a.isContra)!, contra = all.find(a => a.mainType === "ASSET" && a.isContra)!, expense = all.find(a => a.mainType === "EXPENSE" && !a.isContra)!;
    const run = (operation: JournalOperation, payload: object, deps?: JournalDependencies) => executeJournalCommand(db, admin.id, operation, { requestKey: randomUUID(), ...payload }, deps);
    const draft = (date: string, amount = "100", second = amount, deps?: JournalDependencies) => run("CREATE_DRAFT", { date, description: "Jurnal sintetis pengujian", lines: [{ accountId: cash.id, debit: amount, credit: "0" }, { accountId: income.id, debit: "0", credit: second }] }, deps);
    const post = (entry: CommandResult) => run("POST", { id: entry.id, version: entry.version });
    const report = (accountId: string, from: string, to: string, page = 1) => ledgerReport(db, { accountId, from, to, page });
    const year1 = await run("CREATE_YEAR", { year: 2037 }), year2 = await run("CREATE_YEAR", { year: 2038 });
    let original: CommandResult;
    await t.test("draf, idempotency serentak, edit/post nomor stabil dan akurasi Rupiah", async () => {
      const requestKey = randomUUID(), payload = { date: "2037-01-05", description: "Pengujian jurnal seimbang", lines: [{ accountId: cash.id, debit: "100", credit: "0" }, { accountId: income.id, debit: "0", credit: "100" }], requestKey };
      const [a, b] = await Promise.all([run("CREATE_DRAFT", payload), run("CREATE_DRAFT", payload)]);
      assert.deepEqual(a, b); assert.equal((await report(cash.id, "2037-01-01", "2037-01-31")).closing, "0");
      await assert.rejects(run("CREATE_DRAFT", { ...payload, description: "Isi berbeda dengan key sama" }), /isi berbeda/);
      const edited = await run("EDIT_DRAFT", { id: a.id, version: a.version, date: payload.date, description: "Uraian sesudah edit", lines: payload.lines });
      assert.equal(edited.journalNumber, a.journalNumber); assert.notEqual(a.id, a.journalNumber);
      const key = randomUUID(); original = await run("POST", { id: edited.id, version: edited.version, requestKey: key });
      assert.deepEqual(await run("POST", { id: edited.id, version: edited.version, requestKey: key }), original);
      assert.equal(original.journalNumber, a.journalNumber); assert.equal((await report(cash.id, "2037-01-01", "2037-01-31")).closing, "100");
    });
    await t.test("tidak seimbang ditolak atomik, guard database tetap berlaku", async () => {
      const entry = await draft("2037-01-06", "1000000", "999999");
      const requests = await db.journalRequest.count(), audit = await db.auditEvent.count();
      await assert.rejects(post(entry), /sama persis/);
      assert.equal((await db.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })).status, "DRAFT");
      assert.equal(await db.journalRequest.count(), requests); assert.equal(await db.auditEvent.count(), audit);
      await assert.rejects(db.$transaction(async tx => {
        await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", postingStatus: "POSTED", postedAt: new Date(), postedById: admin.id, version: { increment: 1 } } });
        await tx.auditEvent.create({ data: { actorId: admin.id, entity: "JOURNAL", entityId: entry.id, action: "POSTED", details: {} } });
      }));
      await assert.rejects(draft("2037-01-07", "0"));
      await assert.rejects(draft("2037-02-30"));
    });
    await t.test("semua tiga akun kontrol diblokir tanpa subledger", async () => {
      const before = await db.journalEntry.count(), controls = all.filter(a => a.isControlAccount); assert.equal(controls.length, 3);
      for (const account of controls) await assert.rejects(run("CREATE_DRAFT", { date: "2037-01-07", description: "Kontrol tanpa subledger", lines: [{ accountId: account.id, debit: "1", credit: "0" }, { accountId: income.id, debit: "0", credit: "1" }] }), /Akun kontrol/);
      assert.equal(await db.journalEntry.count(), before);
    });
    await t.test("posted immutable di service/DB; riwayat akun dan audit terlindungi", async () => {
      await assert.rejects(run("EDIT_DRAFT", { id: original.id, version: original.version, date: "2037-01-05", description: "Edit jurnal terposting", lines: [{ accountId: cash.id, debit: "100", credit: "0" }, { accountId: income.id, debit: "0", credit: "100" }] }), /pembalik/);
      await assert.rejects(run("DELETE_DRAFT", { id: original.id, version: original.version }), /pembalik/);
      await assert.rejects(db.journalEntry.update({ where: { id: original.id }, data: { description: "Mutasi ilegal", version: { increment: 1 } } }));
      await assert.rejects(db.journalEntry.delete({ where: { id: original.id } }));
      await assert.rejects(db.journalLine.updateMany({ where: { entryId: original.id }, data: { debit: "999" } }));
      await assert.rejects(db.auditEvent.deleteMany({ where: { entityId: original.id } }));
      await assert.rejects(db.journalRequest.deleteMany({ where: { actorId: admin.id } }));
      await assert.rejects(db.account.delete({ where: { id: cash.id } }));
    });
    await t.test("pembatalan atomik, pasangan unik, saldo tanggal historis tetap benar", async () => {
      const payload = { id: original.id, version: original.version, date: "2037-02-01", reason: "Koreksi pengujian pembatalan", requestKey: randomUUID() };
      const reversed = await run("REVERSE", payload); assert.deepEqual(await run("REVERSE", payload), reversed);
      assert.notEqual(reversed.journalNumber, original.journalNumber);
      const origin = await db.journalEntry.findUniqueOrThrow({ where: { id: original.id } }); assert.equal(origin.status, "REVERSED"); assert.equal(origin.postingStatus, "POSTED");
      const jan = await report(cash.id, "2037-01-01", "2037-01-31"), feb = await report(cash.id, "2037-02-01", "2037-02-28");
      assert.equal(jan.closing, "100"); assert.equal(feb.opening, "100"); assert.equal(feb.rows[0].balance, "0"); assert.equal(feb.closing, "0");
      await assert.rejects(run("REVERSE", { ...payload, version: origin.version, requestKey: randomUUID() }), /dibalik lagi/);
    });
    await t.test("kontra kredit, bilangan di atas batas integer JS, urutan bukan nomor acak", async () => {
      const amount = "10000000000000001";
      const a = await run("CREATE_DRAFT", { date: "2037-03-01", description: "Uji kontra saldo normal kredit", lines: [{ accountId: expense.id, debit: amount, credit: "0" }, { accountId: contra.id, debit: "0", credit: amount }] }); await post(a);
      assert.equal((await report(contra.id, "2037-03-01", "2037-03-31")).closing, amount);
      const z = await draft("2037-04-01", "7", "7", { number: () => "JRN-20261028-ZZZZZZZZZZZZ" }); await post(z);
      const a2 = await draft("2037-04-01", "9", "9", { number: () => "JRN-20261028-AAAAAAAAAAAA" }); await post(a2);
      const rows = (await report(cash.id, "2037-04-01", "2037-04-30")).rows;
      assert.equal(rows[0].entryId, z.id); assert.equal(rows[1].entryId, a2.id); assert.equal(rows[1].balance, "16");
    });
    await t.test("collision nomor DB: bounded retry, gagal total rollback, hapus draf tidak mendaur ulang nomor", async () => {
      const reserved = "JRN-20261028-ZZZZZZZZZZZZ"; let calls = 0;
      const entry = await draft("2037-05-01", "1", "1", { number: () => ++calls < 3 ? reserved : "JRN-20261028-BBBBBBBBBBBB" }); assert.equal(calls, 3);
      const before = await db.journalEntry.count(); calls = 0;
      await assert.rejects(draft("2037-05-01", "1", "1", { number: () => { calls++; return reserved; } })); assert.equal(calls, 5); assert.equal(await db.journalEntry.count(), before);
      await run("DELETE_DRAFT", { id: entry.id, version: entry.version });
      assert.equal(await db.journalEntry.findUnique({ where: { id: entry.id } }), null);
      assert.ok(await db.journalNumber.findUnique({ where: { journalNumber: entry.journalNumber! } }));
      assert.ok(await db.auditEvent.findFirst({ where: { entityId: entry.id, action: "DELETED_DRAFT" } }));
    });
    await t.test("periode terkunci menolak create/edit/post/delete; pembalik pada tahun terbuka dan akun diarsipkan", async () => {
      const pending = await draft("2037-12-30", "4"), posted = await post(await draft("2037-12-31", "150"));
      await run("SET_YEAR_STATUS", { id: year1.id, version: year1.version, status: "LOCKED", reason: "Periode uji dikunci" });
      await assert.rejects(draft("2037-12-31"), /terkunci/); await assert.rejects(post(pending), /terkunci/); await assert.rejects(run("DELETE_DRAFT", { id: pending.id, version: pending.version }), /terkunci/);
      await assert.rejects(run("EDIT_DRAFT", { id: pending.id, version: pending.version, date: "2038-01-01", description: "Memindahkan periode terkunci", lines: [{ accountId: cash.id, debit: "4", credit: "0" }, { accountId: income.id, debit: "0", credit: "4" }] }), /terkunci/);
      await assert.rejects(run("REVERSE", { id: posted.id, version: posted.version, date: "2037-12-31", reason: "Tanggal terkunci" }), /terkunci/);
      await db.account.update({ where: { id: cash.id }, data: { isActive: false, version: { increment: 1 } } });
      await run("REVERSE", { id: posted.id, version: posted.version, date: "2038-01-01", reason: "Koreksi pada periode terbuka" });
      const report = await ledgerReport(db, { accountId: cash.id, fiscalYearId: year2.id, from: "2038-01-01", to: "2038-01-31" }); assert.equal(report.opening, "166"); assert.equal(report.closing, "16");
      await assert.rejects(ledgerReport(db, { accountId: cash.id, fiscalYearId: year2.id, from: "2037-12-31", to: "2038-01-31" }), /Rentang/);
      await db.account.update({ where: { id: cash.id }, data: { isActive: true, version: { increment: 1 } } });
    });
    await t.test("saldo berjalan tetap lengkap pada halaman kedua, draf dikecualikan", async () => {
      const lines = Array.from({ length: 51 }, () => ({ accountId: cash.id, debit: "1", credit: "0" })); lines.push({ accountId: income.id, debit: "0", credit: "51" });
      await post(await run("CREATE_DRAFT", { date: "2038-03-01", description: "Uji pagination saldo berjalan", lines }));
      await draft("2038-03-02", "999");
      const result = await report(cash.id, "2038-03-01", "2038-03-31", 2);
      assert.equal(result.opening, "16"); assert.equal(result.count, 51); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].balance, "67"); assert.equal(result.closing, "67");
    });
    await t.test("dua simpan berbeda serentak unik; balapan kunci periode/post konsisten", async () => {
      const [a, b] = await Promise.all([draft("2038-04-01", "3"), draft("2038-04-01", "5")]);
      assert.notEqual(a.id, b.id); assert.notEqual(a.journalNumber, b.journalNumber);
      const fiscal = await run("CREATE_YEAR", { year: 2039 }), entry = await draft("2039-01-01", "8");
      const [posting, locking] = await Promise.allSettled([post(entry), run("SET_YEAR_STATUS", { id: fiscal.id, version: fiscal.version, status: "LOCKED", reason: "Uji konkurensi kunci periode" })]);
      assert.equal(locking.status, "fulfilled");
      assert.equal((await db.fiscalYear.findUniqueOrThrow({ where: { id: fiscal.id } })).status, "LOCKED");
      const saved = await db.journalEntry.findUniqueOrThrow({ where: { id: entry.id } });
      assert.equal(saved.status, posting.status === "fulfilled" ? "POSTED" : "DRAFT");
      if (posting.status === "rejected") assert.match(String(posting.reason), /terkunci/);
      await assert.rejects(draft("2039-01-02"), /terkunci/);
    });
  } finally { await isolated.cleanup(); }
});
