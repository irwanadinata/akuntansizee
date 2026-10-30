import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "../../scripts/load-env";
import { isolatedNeon } from "./neon-schema";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { asDate } from "../../src/lib/accounting/dates";
import { accounts, audit, executeJournalCommand, openYear, reserve, writeLines } from "../../src/lib/journal/engine";
import { newJournalNumber } from "../../src/lib/journal/identity";
import { executeTradeCommand } from "../../src/lib/trade/engine";
import { tradeBalance, tradeReconciliation } from "../../src/lib/trade/balances";
import { tradeDetail, tradeFilters, tradeList } from "../../src/lib/trade/queries";
import { TRADE_CONTROL_CODES, tradeKinds, type TradeKind } from "../../src/lib/trade/validation";

loadLocalEnv();
const url = process.env.TRADE_TEST_DIRECT_URL || process.env.DIRECT_URL;
const enabled = process.env.TRADE_TEST_CONFIRM === "CREATE_TEMP_SCHEMA" && Boolean(url);
type Result = Awaited<ReturnType<typeof executeTradeCommand>>;
type Operation = Parameters<typeof executeTradeCommand>[3];
type Dependencies = NonNullable<Parameters<typeof executeTradeCommand>[5]>;

function safeFailure(error: unknown): Error {
  let message = error instanceof Error ? error.message : "Pengujian trade gagal.";
  for (const secret of [url, process.env.DATABASE_URL, process.env.DIRECT_URL]) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return new Error(message.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, "[REDACTED_DATABASE_URL]"));
}

test("Neon: piutang customer dan utang supplier berasal dari jurnal POSTED atomik", {
  skip: enabled ? false : "Butuh Neon development/test dan TRADE_TEST_CONFIRM=CREATE_TEMP_SCHEMA.",
  timeout: 600000,
}, async t => {
  const isolated = await isolatedNeon(url!).catch(error => { throw safeFailure(error); });
  const { db } = isolated;
  const check = (name: string, work: () => Promise<void>) => t.test(name, async () => {
    try { await work(); } catch (error) { throw safeFailure(error); }
  });
  try {
    const admin = await db.adminUser.create({ data: { email: "trade-test@example.invalid", passwordHash: "test-disabled-" + randomUUID() } });
    const plan = buildSeedPlan(
      readFileSync(new URL("../../prisma/coa-source.json", import.meta.url), "utf8"),
      JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json", import.meta.url), "utf8")),
    );
    await db.account.createMany({ data: plan });
    const eligible = { isActive: true, isContra: false, isControlAccount: false, requiresReview: false };
    const bank = await db.account.findFirstOrThrow({ where: { ...eligible, reportGroup: "CASH_BANK", sourceType: "Bank" } });
    const revenue = await db.account.findFirstOrThrow({ where: { ...eligible, mainType: "REVENUE", normalBalance: "CREDIT" } });
    const expense = await db.account.findFirstOrThrow({ where: { ...eligible, mainType: "EXPENSE", normalBalance: "DEBIT" } });
    const cogs = await db.account.findFirstOrThrow({ where: { ...eligible, mainType: "COGS", normalBalance: "DEBIT" } });
    const asset = await db.account.findFirstOrThrow({ where: { ...eligible, mainType: "ASSET", normalBalance: "DEBIT", reportGroup: { not: "CASH_BANK" } } });
    const controls = {
      RECEIVABLE: await db.account.findUniqueOrThrow({ where: { code: TRADE_CONTROL_CODES.RECEIVABLE } }),
      PAYABLE: await db.account.findUniqueOrThrow({ where: { code: TRADE_CONTROL_CODES.PAYABLE } }),
    };
    for (const year of [2037, 2038, 2039]) await executeJournalCommand(db, admin.id, "CREATE_YEAR", { year, requestKey: randomUUID() });
    assert.equal(await db.account.count(), 91);
    assert.equal(await db.journalEntry.count(), 0);
    assert.equal(await db.tradeDocument.count(), 0);
    assert.equal(await db.tradePayment.count(), 0);

    const run = (kind: TradeKind, operation: Operation, raw: object, deps?: Dependencies) =>
      executeTradeCommand(db, admin.id, kind, operation, { requestKey: randomUUID(), ...raw }, deps);
    const create = (kind: TradeKind, amount = "100", date = "2037-01-02", extra: Record<string, unknown> = {}, deps?: Dependencies) =>
      run(kind, "CREATE_DOCUMENT", { partyName: kind === "RECEIVABLE" ? "Customer A sintetis" : "Supplier X sintetis", date, amount,
        counterAccountId: kind === "RECEIVABLE" ? revenue.id : expense.id, notes: "Pengujian sintetis baru", ...extra }, deps);
    const pay = (kind: TradeKind, documentId: string, amount: string, date = "2037-01-03", extra: Record<string, unknown> = {}, deps?: Dependencies) =>
      run(kind, "CREATE_PAYMENT", { documentId, amount, date, cashAccountId: bank.id, notes: "", ...extra }, deps);
    const balance = (id: string) => db.$transaction(tx => tradeBalance(tx, id));
    const snapshot = async () => ({
      entries: await db.journalEntry.count(), lines: await db.journalLine.count(), numbers: await db.journalNumber.count(),
      documents: await db.tradeDocument.count(), payments: await db.tradePayment.count(), requests: await db.tradeRequest.count(), audits: await db.auditEvent.count(),
    });
    const main: Partial<Record<TradeKind, { document: Result; payment: Result }>> = {};
    const assertLine = async (journalId: string, accountId: string, debit: string, credit: string) => {
      const line = await db.journalLine.findFirstOrThrow({ where: { entryId: journalId, accountId } });
      assert.equal(line.debit.toFixed(0), debit); assert.equal(line.credit.toFixed(0), credit);
    };

    for (const kind of tradeKinds) {
      const receivable = kind === "RECEIVABLE", control = controls[kind], other: TradeKind = receivable ? "PAYABLE" : "RECEIVABLE";
      const documentPrefix = receivable ? "PIU" : "UTG", paymentPrefix = receivable ? "BYC" : "BYS";
      const principal = receivable ? "5000000" : "4000000", firstPayment = receivable ? "2000000" : "1500000", expected = receivable ? "3000000" : "2500000";

      await check(`${kind}: skenario acceptance, jurnal tepat dan kontrol sama dengan detail`, async () => {
        const document = await create(kind, principal), payment = await pay(kind, document.documentId, firstPayment);
        main[kind] = { document, payment };
        assert.equal((await balance(document.documentId)).remaining, expected);
        assert.equal((await balance(document.documentId)).paid, firstPayment);
        assert.match(document.number, new RegExp(`^${documentPrefix}-\\d{8}-[A-F0-9]{12}$`));
        assert.match(payment.number, new RegExp(`^${paymentPrefix}-\\d{8}-[A-F0-9]{12}$`));
        assert.notEqual(document.id, document.number); assert.notEqual(payment.id, payment.number);
        assert.notEqual(document.journalNumber, payment.journalNumber); assert.equal(await db.account.count(), 91);
        await assertLine(document.journalId, control.id, receivable ? principal : "0", receivable ? "0" : principal);
        await assertLine(document.journalId, receivable ? revenue.id : expense.id, receivable ? "0" : principal, receivable ? principal : "0");
        await assertLine(payment.journalId, bank.id, receivable ? firstPayment : "0", receivable ? "0" : firstPayment);
        await assertLine(payment.journalId, control.id, receivable ? "0" : firstPayment, receivable ? firstPayment : "0");
        assert.deepEqual(await tradeReconciliation(db, kind), { control: expected, detail: expected, difference: "0" });
        assert.equal((await tradeReconciliation(db, kind, "2037-01-02")).control, principal);
      });

      await check(`${kind}: overpayment, nominal/tanggal invalid dan relasi silang rollback seluruhnya`, async () => {
        const { document } = main[kind]!; const before = await snapshot();
        await assert.rejects(pay(kind, document.documentId, principal), /melebihi/);
        for (const amount of ["", "0", "-1", "1,5", "1.5", "100000000000000000000"]) await assert.rejects(pay(kind, document.documentId, amount));
        await assert.rejects(pay(kind, document.documentId, "1", "2037-01-01"), /mendahului/);
        await assert.rejects(create(kind, "1", "2037-02-30"));
        await assert.rejects(pay(other, document.documentId, "1"));
        await assert.rejects(run(other, "REVERSE_DOCUMENT", { id: document.documentId, date: "2037-01-03", reason: "Salah jenis dokumen" }));
        await assert.rejects(run(other, "REVERSE_PAYMENT", { id: main[kind]!.payment.id, date: "2037-01-03", reason: "Salah jenis pembayaran" }));
        assert.deepEqual(await snapshot(), before);
      });

      await check(`${kind}: akun lawan sesuai substansi; kas/kontrol/kontra dan akun nonaktif ditolak`, async () => {
        if (!receivable) for (const account of [expense, cogs, asset]) {
          const document = await create(kind, "77", "2037-01-10", { counterAccountId: account.id });
          await assertLine(document.journalId, account.id, "77", "0");
          await assertLine(document.journalId, control.id, "0", "77");
        }
        const before = await snapshot();
        for (const account of [bank, control, receivable ? expense : revenue]) await assert.rejects(create(kind, "1", "2037-01-11", { counterAccountId: account.id }));
        const contra = await db.account.findFirstOrThrow({ where: { isContra: true } });
        await assert.rejects(create(kind, "1", "2037-01-11", { counterAccountId: contra.id }));
        await assert.rejects(pay(kind, main[kind]!.document.documentId, "1", "2037-01-11", { cashAccountId: expense.id }));
        assert.deepEqual(await snapshot(), before);
        const counter = receivable ? revenue : expense;
        await db.account.update({ where: { id: counter.id }, data: { isActive: false, version: { increment: 1 } } });
        try { await assert.rejects(create(kind, "1", "2037-01-11"), /nonaktif/); }
        finally { await db.account.update({ where: { id: counter.id }, data: { isActive: true, version: { increment: 1 } } }); }
      });

      await check(`${kind}: key sama serentak menghasilkan satu dokumen/pembayaran; payload lain ditolak`, async () => {
        const requestKey = randomUUID();
        const [left, right] = await Promise.all([create(kind, "100", "2037-02-01", { requestKey }), create(kind, "100", "2037-02-01", { requestKey })]);
        assert.deepEqual(left, right); assert.equal(await db.tradeDocument.count({ where: { id: left.id } }), 1);
        const paymentKey = randomUUID();
        const [a, b] = await Promise.all([pay(kind, left.documentId, "20", "2037-02-02", { requestKey: paymentKey }), pay(kind, left.documentId, "20", "2037-02-02", { requestKey: paymentKey })]);
        assert.deepEqual(a, b); assert.equal(await db.tradePayment.count({ where: { documentId: left.documentId } }), 1);
        assert.equal((await balance(left.documentId)).remaining, "80");
        await assert.rejects(create(kind, "101", "2037-02-01", { requestKey }), /isi berbeda/);
        await assert.rejects(pay(kind, left.documentId, "21", "2037-02-02", { requestKey: paymentKey }), /isi berbeda/);
      });

      await check(`${kind}: dua key berbeda tidak menghabiskan sisa bersamaan`, async () => {
        const document = await create(kind, "100", "2037-03-01");
        const results = await Promise.allSettled([pay(kind, document.documentId, "70", "2037-03-02"), pay(kind, document.documentId, "70", "2037-03-02")]);
        assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
        assert.equal(results.filter(value => value.status === "rejected").length, 1);
        assert.equal((await balance(document.documentId)).remaining, "30");
        assert.equal(await db.tradePayment.count({ where: { documentId: document.documentId } }), 1);
      });

      await check(`${kind}: pelunasan tepat dan nominal di atas Number.MAX_SAFE_INTEGER tetap presisi`, async () => {
        for (const amount of ["123", "10000000000000001", "99999999999999999999"]) {
          const document = await create(kind, amount, "2037-04-01");
          await pay(kind, document.documentId, amount, "2037-04-02");
          assert.equal((await balance(document.documentId)).remaining, "0");
          assert.equal((await balance(document.documentId)).paid, amount);
          await assert.rejects(pay(kind, document.documentId, "1", "2037-04-03"), /melebihi/);
          assert.equal((await tradeList(db, kind, tradeFilters.parse({ q: document.number, status: "paid" }))).total, 1);
        }
      });

      await check(`${kind}: pembalikan pembayaran/dokumen idempotent menjaga jurnal asal dan histori`, async () => {
        const document = await create(kind, "2000", "2037-05-01"), payment = await pay(kind, document.documentId, "500", "2037-05-02");
        const historical = await tradeReconciliation(db, kind, "2037-05-02");
        const original = await db.journalEntry.findUniqueOrThrow({ where: { id: payment.journalId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
        await assert.rejects(run(kind, "REVERSE_DOCUMENT", { id: document.documentId, date: "2037-05-03", reason: "Masih ada pembayaran" }), /seluruh|pembayaran/);
        const raw = { id: payment.id, date: "2037-05-04", reason: "Koreksi pembayaran sintetis", requestKey: randomUUID() };
        const reversed = await run(kind, "REVERSE_PAYMENT", raw);
        assert.deepEqual(await run(kind, "REVERSE_PAYMENT", raw), reversed);
        assert.equal(reversed.number, payment.number); assert.notEqual(reversed.journalNumber, payment.journalNumber);
        assert.equal((await balance(document.documentId)).remaining, "2000");
        await assert.rejects(run(kind, "REVERSE_PAYMENT", { ...raw, requestKey: randomUUID() }), /sudah dibatalkan/);
        await assert.rejects(run(kind, "REVERSE_DOCUMENT", { id: document.documentId, date: "2037-05-03", reason: "Mendahului pembalik" }), /setelah|seluruh|tanggal/i);
        const cancelled = await run(kind, "REVERSE_DOCUMENT", { id: document.documentId, date: "2037-05-05", reason: "Dokumen salah dicatat" });
        assert.equal(cancelled.number, document.number); assert.equal(cancelled.reversed, true);
        assert.equal((await balance(document.documentId)).remaining, "0"); assert.equal((await balance(document.documentId)).paid, "0");
        await assert.rejects(pay(kind, document.documentId, "1", "2037-05-06"), /dibatalkan/);
        const after = await db.journalEntry.findUniqueOrThrow({ where: { id: payment.journalId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
        assert.equal(after.status, "REVERSED"); assert.equal(after.postingStatus, "POSTED");
        assert.equal(after.journalNumber, original.journalNumber); assert.equal(after.date.toISOString(), original.date.toISOString());
        assert.deepEqual(after.lines.map(line => [line.accountId, line.debit.toFixed(0), line.credit.toFixed(0)]), original.lines.map(line => [line.accountId, line.debit.toFixed(0), line.credit.toFixed(0)]));
        assert.deepEqual(await tradeReconciliation(db, kind, "2037-05-02"), historical);
        const listed = await tradeList(db, kind, tradeFilters.parse({ q: document.number, status: "cancelled" }));
        assert.equal(listed.total, 1); assert.equal(listed.rows[0].remaining, "0");
      });

      await check(`${kind}: backdate tidak boleh membuat outstanding historis negatif`, async () => {
        const document = await create(kind, "100", "2037-06-01"), payment = await pay(kind, document.documentId, "100", "2037-06-02");
        await run(kind, "REVERSE_PAYMENT", { id: payment.id, date: "2037-06-05", reason: "Memulihkan pembayaran" });
        const before = await snapshot();
        await assert.rejects(pay(kind, document.documentId, "100", "2037-06-03"), /historis negatif/);
        assert.deepEqual(await snapshot(), before);
        await pay(kind, document.documentId, "100", "2037-06-06");
        assert.equal((await balance(document.documentId)).remaining, "0");
      });

      await check(`${kind}: dokumen/pembayaran immutable dan kontrol/reversal tidak dapat dilewati lewat jurnal manual`, async () => {
        const { document, payment } = main[kind]!;
        await assert.rejects(db.tradeDocument.update({ where: { id: document.id }, data: { amount: "1", version: { increment: 1 } } }));
        await assert.rejects(db.tradePayment.update({ where: { id: payment.id }, data: { amount: "1", version: { increment: 1 } } }));
        await assert.rejects(db.tradePayment.delete({ where: { id: payment.id } }));
        for (const result of [document, payment]) {
          const journal = await db.journalEntry.findUniqueOrThrow({ where: { id: result.journalId } });
          await assert.rejects(executeJournalCommand(db, admin.id, "REVERSE", { id: journal.id, version: journal.version, date: "2037-06-20", reason: "Lewat jurnal manual", requestKey: randomUUID() }));
        }
        await assert.rejects(executeJournalCommand(db, admin.id, "CREATE_DRAFT", { date: "2037-06-20", description: "Kontrol manual ilegal", requestKey: randomUUID(),
          lines: [{ accountId: control.id, debit: "1", credit: "0" }, { accountId: bank.id, debit: "0", credit: "1" }] }));
      });

      await check(`${kind}: collision ${documentPrefix}/${paymentPrefix}/JRN retry terbatas dan rollback`, async () => {
        const fixed = `${documentPrefix}-20390101-CCCCCCCCCCCC`;
        await create(kind, "20", "2037-07-01", {}, { publicNumber: () => fixed });
        let attempts = 0;
        const document = await create(kind, "20", "2037-07-01", {}, { publicNumber: () => ++attempts < 3 ? fixed : `${documentPrefix}-20390101-DDDDDDDDDDDD` });
        assert.equal(attempts, 3);
        const fixedPayment = `${paymentPrefix}-20390101-CCCCCCCCCCCC`;
        await pay(kind, document.documentId, "1", "2037-07-02", {}, { publicNumber: () => fixedPayment });
        attempts = 0;
        await pay(kind, document.documentId, "1", "2037-07-02", {}, { publicNumber: () => ++attempts < 2 ? fixedPayment : `${paymentPrefix}-20390101-DDDDDDDDDDDD` });
        assert.equal(attempts, 2);
        let before = await snapshot(); attempts = 0;
        await assert.rejects(create(kind, "20", "2037-07-01", {}, { publicNumber: () => { attempts++; return fixed; } }));
        assert.equal(attempts, 5); assert.deepEqual(await snapshot(), before);
        before = await snapshot(); attempts = 0;
        await assert.rejects(pay(kind, document.documentId, "1", "2037-07-02", {}, { publicNumber: () => { attempts++; return fixedPayment; } }));
        assert.equal(attempts, 5); assert.deepEqual(await snapshot(), before);
        attempts = 0;
        await create(kind, "20", "2037-07-03", {}, { number: () => ++attempts < 2 ? document.journalNumber : `JRN-20390101-${receivable ? "AAAAAAAAAAAA" : "BBBBBBBBBBBB"}` });
        assert.equal(attempts, 2); before = await snapshot(); attempts = 0;
        await assert.rejects(create(kind, "20", "2037-07-03", {}, { number: () => { attempts++; return document.journalNumber; } }));
        assert.equal(attempts, 5); assert.deepEqual(await snapshot(), before);
      });

      await check(`${kind}: referensi eksternal opsional/duplikat dan pencarian/status tidak bocor lintas jenis`, async () => {
        const { document, payment } = main[kind]!;
        await create(kind, "10", "2037-08-01", { partyName: "Pihak pertama", externalReference: "EXT-SHARED" });
        await create(kind, "10", "2037-08-01", { partyName: "Pihak kedua", externalReference: "EXT-SHARED" });
        assert.equal(await db.tradeDocument.count({ where: { kind, externalReference: "EXT-SHARED" } }), 2);
        const found = await tradeList(db, kind, tradeFilters.parse({ q: payment.number, year: "2037", status: "partial" }));
        assert.equal(found.total, 1); assert.equal(found.rows[0].id, document.documentId);
        assert.equal(found.rows[0].documentNumber, document.number); assert.equal(found.rows[0].remaining, expected); assert.equal(found.rows[0].paid, firstPayment);
        assert.equal((await tradeList(db, kind, tradeFilters.parse({ q: document.number, status: "unpaid" }))).total, 0);
        assert.equal((await tradeList(db, kind, tradeFilters.parse({ q: receivable ? "Customer A" : "Supplier X", year: "2038" }))).total, 0);
        assert.equal((await tradeList(db, kind, tradeFilters.parse({ q: "%_" }))).total, 0);
        assert.equal((await tradeList(db, other, tradeFilters.parse({ q: document.number }))).total, 0);
        assert.equal(await tradeDetail(db, other, document.documentId), null);
        const detail = await tradeDetail(db, kind, document.documentId);
        assert.equal(detail?.document.partyName, receivable ? "Customer A sintetis" : "Supplier X sintetis");
        assert.equal(detail?.payments.length, 1); assert.equal(detail?.balance.remaining, expected);
        assert.equal((await tradeReconciliation(db, kind)).difference, "0");
      });

      await check(`${kind}: DB menolak pembayaran berlebih/orphan tanpa mengandalkan service`, async () => {
        const document = await create(kind, "100", "2037-09-01"); await pay(kind, document.documentId, "80", "2037-09-02");
        const before = await snapshot();
        const rawPayment = (orphan: boolean) => db.$transaction(async tx => {
          const date = asDate("2037-09-03"), year = await openYear(tx, date), amount = "50";
          const lines = orphan ? [{ accountId: bank.id, debit: amount, credit: "0", description: "" }, { accountId: bank.id, debit: "0", credit: amount, description: "" }]
            : receivable ? [{ accountId: bank.id, debit: amount, credit: "0", description: "" }, { accountId: control.id, debit: "0", credit: amount, description: "" }]
              : [{ accountId: control.id, debit: amount, credit: "0", description: "" }, { accountId: bank.id, debit: "0", credit: amount, description: "" }];
          await accounts(tx, lines, false, control.id);
          const entry = await tx.journalEntry.create({ data: { date, description: "Guard trade sintetis", fiscalYearId: year.id, createdById: admin.id,
            sourceType: orphan ? "TRADE_DOCUMENT" : "TRADE_PAYMENT", journalNumber: await reserve(tx, () => new Date(), newJournalNumber) } });
          if (!orphan) {
            const payment = await tx.tradePayment.create({ data: { documentId: document.documentId, paymentNumber: `${paymentPrefix}-20390101-EEEEEEEEEEEE`, date,
              amount, cashAccountId: bank.id, journalEntryId: entry.id, createdById: admin.id } });
            await audit(tx, admin.id, payment.id, "CREATED", {}, "TRADE_PAYMENT");
          }
          await writeLines(tx, entry.id, lines);
          await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", postingStatus: "POSTED", postedAt: new Date(), postedById: admin.id, version: { increment: 1 } } });
          await audit(tx, admin.id, entry.id, "POSTED", {});
        });
        const reason = (error: unknown) => {
          const e = error as { message?: string; meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } };
          return [e.message, e.meta?.driverAdapterError?.cause?.originalMessage].join(" ");
        };
        await assert.rejects(rawPayment(false), error => { assert.match(reason(error), /historis negatif|melebihi/); return true; });
        await assert.rejects(rawPayment(true), error => { assert.match(reason(error), /subledger/); return true; });
        assert.deepEqual(await snapshot(), before); assert.equal((await balance(document.documentId)).remaining, "20");
      });
    }

    await check("LOCKED menolak transaksi; pembalik lintas tahun dengan akun arsip tetap sah", async () => {
      const targets: { kind: TradeKind; document: Result; payment: Result }[] = [];
      for (const kind of tradeKinds) {
        const document = await create(kind, "100", "2037-12-01"), payment = await pay(kind, document.documentId, "20", "2037-12-02");
        targets.push({ kind, document, payment });
      }
      const year = await db.fiscalYear.findUniqueOrThrow({ where: { year: 2037 } });
      await executeJournalCommand(db, admin.id, "SET_YEAR_STATUS", { id: year.id, version: year.version, status: "LOCKED", reason: "Uji periode sintetis", requestKey: randomUUID() });
      for (const { kind, document, payment } of targets) {
        await assert.rejects(create(kind, "10", "2037-12-31"), /terkunci/);
        await assert.rejects(pay(kind, document.documentId, "1", "2037-12-31"), /terkunci/);
        await assert.rejects(run(kind, "REVERSE_PAYMENT", { id: payment.id, date: "2037-12-31", reason: "Backdate terkunci" }), /terkunci/);
        const historical = await tradeReconciliation(db, kind, "2037-12-31");
        await db.account.update({ where: { id: controls[kind].id }, data: { isActive: false, version: { increment: 1 } } });
        const counter = kind === "RECEIVABLE" ? revenue : expense;
        await db.account.update({ where: { id: counter.id }, data: { isActive: false, version: { increment: 1 } } });
        await run(kind, "REVERSE_PAYMENT", { id: payment.id, date: "2038-01-01", reason: "Koreksi lintas tahun" });
        await run(kind, "REVERSE_DOCUMENT", { id: document.documentId, date: "2038-01-02", reason: "Koreksi lintas tahun" });
        assert.equal((await balance(document.documentId)).remaining, "0");
        assert.deepEqual(await tradeReconciliation(db, kind, "2037-12-31"), historical);
        assert.equal((await tradeReconciliation(db, kind)).difference, "0");
      }
      assert.equal(await db.account.count(), 91);
    });
  } catch (error) {
    throw safeFailure(error);
  } finally {
    await isolated.cleanup().catch(error => { throw safeFailure(error); });
  }
});
