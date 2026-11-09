import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {loadLocalEnv} from "../../scripts/load-env";
import {buildSeedPlan} from "../../src/lib/coa/seed-plan";
import {executeJournalCommand} from "../../src/lib/journal/engine";
import {executeSourceJournalUpdate} from "../../src/lib/journal/source-edit";
import {executeLoanCommand} from "../../src/lib/loans/engine";
import {executeTradeCommand} from "../../src/lib/trade/engine";
import {loanBalance,loanReconciliation} from "../../src/lib/loans/balances";
import {tradeBalance,tradeReconciliation} from "../../src/lib/trade/balances";
import {financialReport} from "../../src/lib/reports/engine";
import {isolatedNeon} from "./neon-schema";
import {seedLegacyReversal} from "../fixtures/legacy-reversal";
loadLocalEnv();
const enabled=process.env.JOURNAL_TEST_CONFIRM==="CREATE_TEMP_SCHEMA"&&Boolean(process.env.JOURNAL_TEST_DIRECT_URL||process.env.DIRECT_URL);
test("PostgreSQL: pengeditan jurnal otomatis dan transaksi asal tersimpan atomik",{skip:enabled?false:"Perlu target uji jurnal.",timeout:360000},async t=>{
 const isolated=await isolatedNeon(process.env.JOURNAL_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
 try{
  const admin=await db.adminUser.create({data:{email:"source-edit@example.invalid",passwordHash:"disabled-test-only"}});
  const plan=buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json",import.meta.url),"utf8"),JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json",import.meta.url),"utf8")));await db.account.createMany({data:plan});
  const all=await db.account.findMany(),cash=all.filter(a=>a.reportGroup==="CASH_BANK"),income=all.find(a=>a.mainType==="REVENUE"&&!a.isContra)!,expense=all.find(a=>a.mainType==="EXPENSE"&&!a.isContra)!;
  for(const year of[2037,2038])await executeJournalCommand(db,admin.id,"CREATE_YEAR",{year,requestKey:randomUUID()});
  const loan=(amount="1000",date="2037-01-01",more={})=>executeLoanCommand(db,admin.id,"CREATE_LOAN",{employeeName:"Karyawan awal",date,amount,cashAccountId:cash[0].id,requestKey:randomUUID(),...more});
  const installment=(loanId:string,amount="100",date="2037-01-02",more={})=>executeLoanCommand(db,admin.id,"CREATE_PAYMENT",{loanId,date,amount,cashAccountId:cash[0].id,requestKey:randomUUID(),...more});
  const document=(kind:"RECEIVABLE"|"PAYABLE",amount="1000",date="2037-01-01",more={})=>executeTradeCommand(db,admin.id,kind,"CREATE_DOCUMENT",{partyName:"Pihak awal",date,amount,counterAccountId:kind==="RECEIVABLE"?income.id:expense.id,requestKey:randomUUID(),...more});
  const payment=(kind:"RECEIVABLE"|"PAYABLE",documentId:string,amount="100",date="2037-01-02",more={})=>executeTradeCommand(db,admin.id,kind,"CREATE_PAYMENT",{documentId,date,amount,cashAccountId:cash[0].id,requestKey:randomUUID(),...more});
  const payload=async(id:string,changes:object={})=>{
   const row=await db.journalEntry.findUniqueOrThrow({where:{id},include:{loan:true,loanPayment:{include:{loan:true}},tradeDocument:true,tradePayment:{include:{document:true}}}});
   const common={id,version:row.version,journalNumber:row.journalNumber,sourceType:row.sourceType,date:row.date.toISOString().slice(0,10),reason:"Koreksi sesuai bukti",requestKey:randomUUID()};
   const source=row.loan??row.loanPayment??row.tradeDocument??row.tradePayment;if(!source)throw Error("No source");
   const base={...common,sourceVersion:source.version,amount:source.amount.toFixed(0),notes:source.notes??""};
   if(row.loan)return{...base,employeeName:row.loan.employeeName,cashAccountId:row.loan.cashAccountId,dueDate:row.loan.dueDate?.toISOString().slice(0,10)??"",...changes};
   if(row.loanPayment)return{...base,cashAccountId:row.loanPayment.cashAccountId,parentVersion:row.loanPayment.loan.version,...changes};
   if(row.tradeDocument)return{...base,kind:row.tradeDocument.kind,partyName:row.tradeDocument.partyName,counterAccountId:row.tradeDocument.counterAccountId,dueDate:row.tradeDocument.dueDate?.toISOString().slice(0,10)??"",externalReference:row.tradeDocument.externalReference??"",...changes};
   return{...base,kind:row.tradePayment!.document.kind,cashAccountId:row.tradePayment!.cashAccountId,parentVersion:row.tradePayment!.document.version,...changes};
  };
  const update=async(id:string,changes:object={})=>executeSourceJournalUpdate(db,admin.id,await payload(id,changes));
  const state=async()=>JSON.stringify({journals:await db.journalEntry.findMany({orderBy:{id:"asc"},include:{lines:{orderBy:{lineNo:"asc"}}}}),loans:await db.loan.findMany({orderBy:{id:"asc"}}),installments:await db.loanPayment.findMany({orderBy:{id:"asc"}}),documents:await db.tradeDocument.findMany({orderBy:{id:"asc"}}),payments:await db.tradePayment.findMany({orderBy:{id:"asc"}}),numbers:await db.journalNumber.count(),audit:await db.auditEvent.count(),requests:await db.journalRequest.count()});
  const parent=await loan("1000","2037-01-01",{journalNumber:"PJM/JU/001"}),paid=await installment(parent.id,"100","2037-01-02",{journalNumber:"CIC/JU/001"});
  await t.test("pinjaman dan cicilan menerima nomor jurnal manual dan langsung terposting",async()=>{
   assert.equal(parent.journalNumber,"PJM/JU/001");assert.equal(paid.journalNumber,"CIC/JU/001");assert.equal(await db.journalEntry.count({where:{status:"DRAFT"}}),0);
  });
  await t.test("edit pinjaman memperbarui nama, tanggal, kas, nominal, jurnal dan sisa sekaligus",async()=>{
   await update(parent.journalId,{employeeName:"Nama terkoreksi",date:"2037-01-01",amount:"1500",cashAccountId:cash[1].id,notes:"Bukti diperiksa",journalNumber:"PJM/JU/001A"});
   const row=await db.loan.findUniqueOrThrow({where:{id:parent.id}});assert.equal(row.employeeName,"Nama terkoreksi");assert.equal(row.amount.toFixed(0),"1500");assert.equal(row.cashAccountId,cash[1].id);assert.equal((await db.$transaction(tx=>loanBalance(tx,parent.id))).remaining,"1400");
   const journal=await db.journalEntry.findUniqueOrThrow({where:{id:parent.journalId},include:{lines:true}});assert.equal(journal.journalNumber,"PJM/JU/001A");assert.ok(journal.description.includes("Nama terkoreksi"));assert.equal(journal.lines.find(line=>line.accountId===row.controlAccountId)!.debit.toFixed(0),"1500");
  });
  await t.test("edit cicilan idempotent memperbarui akun/tanggal/nominal tanpa menambah jurnal",async()=>{
   const before=await db.journalEntry.count(),value=await payload(paid.journalId,{amount:"200",date:"2037-01-04",cashAccountId:cash[1].id}),first=await executeSourceJournalUpdate(db,admin.id,value);assert.deepEqual(await executeSourceJournalUpdate(db,admin.id,value),first);assert.equal(await db.journalEntry.count(),before);assert.equal((await db.$transaction(tx=>loanBalance(tx,parent.id))).remaining,"1300");assert.equal((await loanReconciliation(db)).difference,"0");
  });
  await t.test("pengurangan pinjaman di bawah cicilan, overpayment, dan tanggal tidak sah rollback penuh",async()=>{
   for(const [id,changes]of[[parent.journalId,{amount:"150",journalNumber:"PJM/ROLLBACK"}],[paid.journalId,{amount:"1600",journalNumber:"CIC/ROLLBACK"}],[paid.journalId,{date:"2036-12-31"}],[parent.journalId,{date:"2037-01-05"}]]as const){const before=await state();await assert.rejects(update(id,changes));assert.equal(await state(),before);}
  });
  for(const kind of["RECEIVABLE","PAYABLE"]as const){
   const doc=await document(kind,"1000","2037-02-01",{journalNumber:kind+"/JU/001"}),pay=await payment(kind,doc.id,"100","2037-02-02",{journalNumber:kind+"/BYR/001"});
   await t.test(kind+": edit tagihan dan pembayaran menjaga rekonsiliasi serta referensi bisnis",async()=>{
    await update(doc.journalId,{partyName:"Pihak terkoreksi",amount:"1700",dueDate:"2037-03-01",externalReference:"INV-CORRECTED",journalNumber:kind+"/JU/EDIT"});await update(pay.journalId,{amount:"300",date:"2037-02-03",cashAccountId:cash[1].id,notes:"Koreksi pembayaran"});
    const stored=await db.tradeDocument.findUniqueOrThrow({where:{id:doc.id}}),paid=await db.tradePayment.findUniqueOrThrow({where:{id:pay.id}});assert.equal(stored.partyName,"Pihak terkoreksi");assert.equal(stored.externalReference,"INV-CORRECTED");assert.equal(stored.documentNumber,doc.number);assert.equal(paid.paymentNumber,pay.number);assert.equal(paid.amount.toFixed(0),"300");assert.equal((await db.$transaction(tx=>tradeBalance(tx,doc.id))).remaining,"1400");assert.equal((await tradeReconciliation(db,kind)).difference,"0");
    assert.equal(await db.auditEvent.count({where:{entityId:doc.id,action:"UPDATED"}}),1);assert.equal(await db.auditEvent.count({where:{entityId:pay.id,action:"UPDATED"}}),1);
   });
   await t.test(kind+": nominal/tanggal/jenis salah dan nomor bentrok ditolak atomik",async()=>{
    for(const [id,changes]of[[doc.journalId,{amount:"200"}],[doc.journalId,{date:"2037-02-04"}],[pay.journalId,{amount:"1800"}],[pay.journalId,{date:"2037-01-31"}],[doc.journalId,{kind:kind==="RECEIVABLE"?"PAYABLE":"RECEIVABLE"}],[pay.journalId,{journalNumber:"PJM/JU/001A"}]]as const){const before=await state();await assert.rejects(update(id,changes));assert.equal(await state(),before);}
   });
   await t.test(kind+": editor basi ditolak setelah pembayaran baru dan dua edit bersamaan terserialisasi",async()=>{
    const stale=await payload(pay.journalId,{amount:"350"});await payment(kind,doc.id,"50","2037-02-04");await assert.rejects(executeSourceJournalUpdate(db,admin.id,stale),/sudah berubah/);
    const a=await payload(pay.journalId,{amount:"350"}),b={...a,requestKey:randomUUID(),amount:"400"},results=await Promise.allSettled([executeSourceJournalUpdate(db,admin.id,a),executeSourceJournalUpdate(db,admin.id,b)]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal((await tradeReconciliation(db,kind)).difference,"0");
   });
   await t.test(kind+": perubahan SQL tanpa audit/jurnal tertaut tetap ditolak",async()=>{
    await assert.rejects(db.tradeDocument.update({where:{id:doc.id},data:{amount:"1",version:{increment:1}}}));await assert.rejects(db.tradePayment.update({where:{id:pay.id},data:{amount:"1",version:{increment:1}}}));
   });
  }
  await t.test("pengeditan nominal bersamaan pembayaran baru tidak menghasilkan saldo negatif",async()=>{
   const target=await loan("100","2037-05-01"),value=await payload(target.journalId,{amount:"60"}),results=await Promise.allSettled([executeSourceJournalUpdate(db,admin.id,value),installment(target.id,"80","2037-05-02")]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.ok(BigInt((await db.$transaction(tx=>loanBalance(tx,target.id))).remaining)>=0n);assert.equal((await loanReconciliation(db)).difference,"0");
  });
  await t.test("riwayat transaksi yang pernah dibatalkan tetap terlindungi",async()=>{
   const target=await document("RECEIVABLE","20","2037-06-01");await seedLegacyReversal(db,admin.id,target.journalId,"2037-06-02");const before=await state();await assert.rejects(update(target.journalId,{amount:"30"}));assert.equal(await state(),before);
  });
  await t.test("laporan dari jurnal yang diperbarui tetap seimbang dan semua kontrol cocok",async()=>{
   const report=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});assert.equal(report.balance.difference,"0");for(const row of report.diagnostics.reconciliations)assert.equal(row.difference,"0");assert.equal(await db.journalEntry.count({where:{status:"DRAFT"}}),0);
  });
  await t.test("periode asal terkunci menolak pengeditan jurnal otomatis lintas tahun",async()=>{
   const fiscal=await db.fiscalYear.findUniqueOrThrow({where:{year:2037}});await executeJournalCommand(db,admin.id,"SET_YEAR_STATUS",{id:fiscal.id,version:fiscal.version,status:"LOCKED",reason:"Tutup periode",requestKey:randomUUID()});const before=await state();await assert.rejects(update(parent.journalId,{date:"2038-01-01",dueDate:"",amount:"1800"}));assert.equal(await state(),before);
  });
 }finally{await isolated.cleanup();}
});
