import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "../../scripts/load-env";
import { isolatedNeon } from "./neon-schema";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { executeJournalCommand,accounts,audit,openYear,reserve,writeLines } from "../../src/lib/journal/engine";
import { newJournalNumber } from "../../src/lib/journal/identity";
import { asDate } from "../../src/lib/accounting/dates";
import { loanList,loanFilters,loanDetail } from "../../src/lib/loans/queries";
import { executeLoanCommand, type LoanOperation, type LoanResult, type LoanDependencies } from "../../src/lib/loans/engine";
import { loanBalance, loanReconciliation } from "../../src/lib/loans/balances";
loadLocalEnv();
const enabled = process.env.LOAN_TEST_CONFIRM === "CREATE_TEMP_SCHEMA" && Boolean(process.env.LOAN_TEST_DIRECT_URL || process.env.DIRECT_URL);
test("Neon: Pinjaman Karyawan dan cicilan atomik", { skip: enabled ? false : "Butuh Neon development/test dan LOAN_TEST_CONFIRM=CREATE_TEMP_SCHEMA.", timeout: 360000 }, async t => {
  const isolated = await isolatedNeon(process.env.LOAN_TEST_DIRECT_URL || process.env.DIRECT_URL!); const { db } = isolated;
  try {
    const admin = await db.adminUser.create({ data: { email: "loan-test@example.invalid", passwordHash: "test-disabled-" + randomUUID() } });
    const plan = buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json", import.meta.url), "utf8"), JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json", import.meta.url), "utf8")));
    await db.account.createMany({ data: plan });
    const cash = await db.account.findFirstOrThrow({ where: { reportGroup: "CASH_BANK" } }), control = await db.account.findUniqueOrThrow({ where: { code: "1122.1" } });
    for (const year of [2037, 2038]) await executeJournalCommand(db, admin.id, "CREATE_YEAR", { year, requestKey: randomUUID() });
    const run = (op: LoanOperation, data: object, deps?: LoanDependencies) => executeLoanCommand(db, admin.id, op, { requestKey: randomUUID(), ...data }, deps);
    const create = (amount = "2000000", date = "2037-01-01", more = {}, deps?: LoanDependencies) => run("CREATE_LOAN", { employeeName: "Budi", date, amount, cashAccountId: cash.id, notes: "Pengujian sintetis", ...more }, deps);
    const pay = (loanId: string, amount: string, date = "2037-01-02", more = {}, deps?: LoanDependencies) => run("CREATE_PAYMENT", { loanId, amount, date, cashAccountId: cash.id, notes: "", ...more }, deps);
    const balance = (id: string) => db.$transaction(tx => loanBalance(tx, id));
    let loan: LoanResult, p1: LoanResult, p2: LoanResult;
    await t.test("2 juta - 500 ribu - 250 ribu = 1.250.000, jurnal/control sama dan 91 COA tetap", async () => {
      loan = await create(); p1 = await pay(loan.loanId, "500.000"); p2 = await pay(loan.loanId, "250000", "2037-01-03");
      assert.equal((await balance(loan.loanId)).remaining, "1250000"); assert.equal((await balance(loan.loanId)).paid, "750000");
      assert.match(loan.number, /^PJM-\d{8}-[A-F0-9]{12}$/); assert.match(p1.number, /^CIC-\d{8}-[A-F0-9]{12}$/); assert.notEqual(p1.journalNumber, p2.journalNumber);
      const lines = await db.journalLine.findMany({ where: { entryId: loan.journalId } }); assert.equal(lines.find(line => line.accountId === control.id)?.debit.toFixed(0), "2000000"); assert.equal(lines.find(line => line.accountId === cash.id)?.credit.toFixed(0), "2000000");
      assert.equal(await db.account.count(), 91); assert.deepEqual(await loanReconciliation(db), { control: "1250000", detail: "1250000", difference: "0" });
      assert.equal((await loanReconciliation(db, "2037-01-01")).control, "2000000");
    });
    await t.test("overpayment, nol, nominal/tanggal tidak sah ditolak tanpa jurnal sebagian", async () => {
      const before = { entries: await db.journalEntry.count(), payments: await db.loanPayment.count(), requests: await db.loanRequest.count() };
      await assert.rejects(pay(loan.loanId, "2000000"), /melebihi/);
      for (const amount of ["", "0", "-1", "1,5", "100000000000000000000"]) await assert.rejects(pay(loan.loanId, amount));
      await assert.rejects(pay(loan.loanId, "1", "2036-12-31"), /mendahului/); await assert.rejects(create("1", "2037-02-30"));
      assert.deepEqual({ entries: await db.journalEntry.count(), payments: await db.loanPayment.count(), requests: await db.loanRequest.count() }, before);
    });
    await t.test("key sama serentak tepat satu pinjaman/cicilan; hash berbeda ditolak", async () => {
      const key = randomUUID(); const [a,b] = await Promise.all([create("100", "2037-02-01", { requestKey: key }), create("100", "2037-02-01", { requestKey: key })]); assert.deepEqual(a,b);
      const pk = randomUUID(); const [x,y] = await Promise.all([pay(a.loanId, "20", "2037-02-02", { requestKey: pk }), pay(a.loanId, "20", "2037-02-02", { requestKey: pk })]); assert.deepEqual(x,y);
      assert.equal(await db.loanPayment.count({ where: { loanId: a.loanId } }), 1); assert.equal((await balance(a.loanId)).remaining, "80");
      await assert.rejects(pay(a.loanId, "21", "2037-02-02", { requestKey: pk }), /isi berbeda/);
    });
    await t.test("dua cicilan berbeda serentak tidak menghabiskan sisa dua kali", async () => {
      const entry = await create("100", "2037-03-01");
      const results = await Promise.allSettled([pay(entry.loanId, "70", "2037-03-02"), pay(entry.loanId, "70", "2037-03-02")]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected").length, 1);
      assert.equal((await balance(entry.loanId)).remaining, "30"); assert.equal(await db.loanPayment.count({ where: { loanId: entry.loanId } }), 1);
    });
    await t.test("lunas tepat, status dihitung tanpa balance editable", async () => {
      const entry = await create("123", "2037-04-01"); await pay(entry.loanId, "123", "2037-04-02"); assert.equal((await balance(entry.loanId)).remaining, "0"); await assert.rejects(pay(entry.loanId, "1", "2037-04-03"), /melebihi/);
    });
    await t.test("pembalik cicilan idempotent memulihkan sisa, asal tetap historis", async () => {
      const payload = { id: p2.id, date: "2037-01-04", reason: "Koreksi cicilan sintetis", requestKey: randomUUID() };
      const reversed = await run("REVERSE_PAYMENT", payload); assert.deepEqual(await run("REVERSE_PAYMENT", payload), reversed); assert.notEqual(reversed.journalNumber, p2.journalNumber);
      assert.equal((await balance(loan.loanId)).remaining, "1500000");
      assert.equal((await loanReconciliation(db, "2037-01-03")).control, "1250000");
      await assert.rejects(run("REVERSE_PAYMENT", { ...payload, requestKey: randomUUID() }), /sudah dibatalkan/);
      await assert.rejects(run("REVERSE_LOAN", { id: loan.loanId, date: "2037-01-04", reason: "Masih cicilan aktif" }), /seluruh cicilan/);
    });
    await t.test("batalkan cicilan dahulu lalu pinjaman; tanggal aman, kontrol bersih", async () => {
      await run("REVERSE_PAYMENT", { id: p1.id, date: "2037-01-05", reason: "Koreksi seluruh transaksi" });
      await assert.rejects(run("REVERSE_LOAN", { id: loan.loanId, date: "2037-01-04", reason: "Tanggal terlalu awal" }), /seluruh cicilan/);
      await run("REVERSE_LOAN", { id: loan.loanId, date: "2037-01-06", reason: "Pinjaman salah dicatat" }); assert.equal((await balance(loan.loanId)).remaining, "0"); assert.equal((await balance(loan.loanId)).paid, "0"); await assert.rejects(pay(loan.loanId, "1", "2037-01-07"), /dibatalkan/);
    });
    await t.test("backdate tidak boleh membuat sisa historis negatif meski sisa saat ini cukup", async () => {
      const entry = await create("100", "2037-05-01"), payment = await pay(entry.loanId, "100", "2037-05-02");
      await run("REVERSE_PAYMENT", { id: payment.id, date: "2037-05-05", reason: "Memulihkan cicilan" });
      const count = await db.loanPayment.count(); await assert.rejects(pay(entry.loanId, "100", "2037-05-03"), /historis negatif/); assert.equal(await db.loanPayment.count(), count);
      await pay(entry.loanId, "100", "2037-05-06"); assert.equal((await balance(entry.loanId)).remaining, "0");
    });
    await t.test("posted immutable, manual kontrol/reversal diblokir, kas salah/nonaktif ditolak", async () => {
      const expense = await db.account.findFirstOrThrow({ where: { mainType: "EXPENSE" } }); await assert.rejects(create("10", "2037-06-01", { cashAccountId: expense.id }), /Kas\/Bank/);
      await assert.rejects(db.loan.update({ where: { id: loan.loanId }, data: { amount: "1", version: { increment: 1 } } })); await assert.rejects(db.loanPayment.delete({ where: { id: p1.id } }));
      const j = await db.journalEntry.findUniqueOrThrow({ where: { id: p1.journalId } }); await assert.rejects(executeJournalCommand(db, admin.id, "REVERSE", { id: j.id, version: j.version, date: "2037-06-01", reason: "Lewat manual", requestKey: randomUUID() }));
      await assert.rejects(executeJournalCommand(db, admin.id, "CREATE_DRAFT", { date: "2037-06-01", description: "Kontrol manual ilegal", requestKey: randomUUID(), lines: [{ accountId: control.id, debit: "1", credit: "0" }, { accountId: cash.id, debit: "0", credit: "1" }] }));
      await db.account.update({ where: { id: cash.id }, data: { isActive: false, version: { increment: 1 } } }); await assert.rejects(create("10", "2037-06-01"), /nonaktif/); await db.account.update({ where: { id: cash.id }, data: { isActive: true, version: { increment: 1 } } });
    });
    await t.test("collision PJM/CIC/JRN retry dibatasi, audit/nomor unik dan rollback", async () => {
      const fixed = "PJM-20261028-ZZZZZZZZZZZZ"; await create("10", "2037-07-01", {}, { publicNumber: () => fixed }); let n=0;
      const entry = await create("10", "2037-07-01", {}, { publicNumber: () => ++n < 3 ? fixed : "PJM-20261028-AAAAAAAAAAAA" }); assert.equal(n,3);
      const cic = "CIC-20261028-ZZZZZZZZZZZZ"; await pay(entry.loanId, "1", "2037-07-02", {}, { publicNumber: () => cic }); n=0;
      await pay(entry.loanId, "1", "2037-07-02", {}, { publicNumber: () => ++n < 2 ? cic : "CIC-20261028-AAAAAAAAAAAA" }); assert.equal(n,2);
      const count = await db.journalEntry.count(); n=0; await assert.rejects(create("10", "2037-07-01", {}, { publicNumber: () => { n++; return fixed; } })); assert.equal(n,5); assert.equal(await db.journalEntry.count(),count);
      const jrn = entry.journalNumber; n=0; await create("10", "2037-07-01", {}, { number: () => ++n < 2 ? jrn : "JRN-20261028-CCCCCCCCCCCC" }); assert.equal(n,2);
    });
    await t.test("list/detail: pencarian nama/PJM/CIC, tahun, status dan saldo diturunkan dari jurnal",async()=>{
      const found=await loanList(db,loanFilters.parse({q:p1.number}));assert.equal(found.total,1);assert.equal(found.rows[0].id,loan.loanId);assert.equal(found.rows[0].remaining,"0");assert.ok(found.rows[0].reversalEntryId);
      assert.equal((await loanList(db,loanFilters.parse({q:loan.number,status:"unpaid"}))).total,0);
      assert.equal((await loanList(db,loanFilters.parse({q:"Budi",year:"2038"}))).total,0);
      assert.equal((await loanList(db,loanFilters.parse({q:"%_"}))).total,0);
      const result=await loanDetail(db,loan.loanId);assert.equal(result?.total,2);assert.equal(result?.balance.paid,"0");assert.equal(result?.payments.length,2);assert.equal(result?.loan.employeeName,"Budi");
    });
    await t.test("DB menolak overpayment tanpa service dan jurnal otomatis tanpa subledger",async()=>{
      const target=await create("100","2037-09-01");await pay(target.loanId,"80","2037-09-02");const before=await db.journalEntry.count();
      const rawPayment=async(orphan:boolean)=>db.$transaction(async tx=>{
        const date=asDate("2037-09-03"),year=await openYear(tx,date),amount="50";
        const lines=orphan?[{accountId:cash.id,debit:amount,credit:"0",description:""},{accountId:cash.id,debit:"0",credit:amount,description:""}]:[{accountId:cash.id,debit:amount,credit:"0",description:""},{accountId:control.id,debit:"0",credit:amount,description:""}];
        await accounts(tx,lines,false,control.id);const entry=await tx.journalEntry.create({data:{date,description:"Uji guard subledger DB",fiscalYearId:year.id,createdById:admin.id,sourceType:orphan?"LOAN":"LOAN_PAYMENT",journalNumber:await reserve(tx,()=>new Date(),newJournalNumber)}});
        if(!orphan){const p=await tx.loanPayment.create({data:{loanId:target.loanId,paymentNumber:"CIC-20261028-DDDDDDDDDDDD",date,amount,cashAccountId:cash.id,journalEntryId:entry.id,createdById:admin.id}});await audit(tx,admin.id,p.id,"CREATED",{},"LOAN_PAYMENT");}
        await writeLines(tx,entry.id,lines);await tx.journalEntry.update({where:{id:entry.id},data:{status:"POSTED",postingStatus:"POSTED",postedAt:new Date(),postedById:admin.id,version:{increment:1}}});await audit(tx,admin.id,entry.id,"POSTED",{});
      });
      const reason=(error:unknown)=>{const e=error as {message?:string;meta?:{driverAdapterError?:{cause?:{originalMessage?:string}}}};return [e.message,e.meta?.driverAdapterError?.cause?.originalMessage].join(" ");};
      await assert.rejects(rawPayment(false),error=>{assert.match(reason(error),/historis negatif/);return true;});
      await assert.rejects(rawPayment(true),error=>{assert.match(reason(error),/subledger/);return true;});
      assert.equal(await db.journalEntry.count(),before);assert.equal((await balance(target.loanId)).remaining,"20");
    });
    await t.test("periode LOCKED menolak pinjaman/cicilan; koreksi tahun berikut dan akun arsip aman", async () => {
      const entry = await create("100", "2037-12-01"), p = await pay(entry.loanId, "20", "2037-12-02");
      const fiscal = await db.fiscalYear.findUniqueOrThrow({ where: { year: 2037 } }); await executeJournalCommand(db, admin.id, "SET_YEAR_STATUS", { id: fiscal.id, version: fiscal.version, status: "LOCKED", reason: "Periode terkunci test", requestKey: randomUUID() });
      await assert.rejects(create("10", "2037-12-31"), /terkunci/); await assert.rejects(pay(entry.loanId, "1", "2037-12-31"), /terkunci/); await assert.rejects(run("REVERSE_PAYMENT", { id: p.id, date: "2037-12-31", reason: "Backdate terkunci" }), /terkunci/);
      await db.account.update({ where: { id: control.id }, data: { isActive: false, version: { increment: 1 } } }); await run("REVERSE_PAYMENT", { id: p.id, date: "2038-01-01", reason: "Koreksi lintas tahun" }); await run("REVERSE_LOAN", { id: entry.loanId, date: "2038-01-02", reason: "Koreksi lintas tahun" }); assert.equal((await balance(entry.loanId)).remaining,"0");
      const reconciliation = await loanReconciliation(db); assert.equal(reconciliation.difference,"0"); assert.equal(await db.account.count(),91);
    });
  } finally { await isolated.cleanup(); }
});
