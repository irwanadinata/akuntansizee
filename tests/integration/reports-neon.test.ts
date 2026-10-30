import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdirSync,writeFileSync } from "node:fs";
import { resolve,join } from "node:path";
import { loadLocalEnv } from "../../scripts/load-env";
import { isolatedNeon } from "./neon-schema";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { executeJournalCommand,type CommandResult } from "../../src/lib/journal/engine";
import { executeLoanCommand } from "../../src/lib/loans/engine";
import { executeTradeCommand } from "../../src/lib/trade/engine";
import { financialReport } from "../../src/lib/reports/engine";
import { ledgerReport } from "../../src/lib/ledger/report";
loadLocalEnv();
const enabled=process.env.REPORT_TEST_CONFIRM==="CREATE_TEMP_SCHEMA"&&Boolean(process.env.REPORT_TEST_DIRECT_URL||process.env.DIRECT_URL);
test("Neon: laporan hanya jurnal posted, saldo lintas tahun dan rekonsiliasi",{skip:enabled?false:"Butuh Neon development/test dan REPORT_TEST_CONFIRM=CREATE_TEMP_SCHEMA.",timeout:360000},async t=>{
  const isolated=await isolatedNeon(process.env.REPORT_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
  try{
    const admin=await db.adminUser.create({data:{email:"report-test@example.invalid",passwordHash:"test-disabled-"+randomUUID()}});
    const plan=buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json",import.meta.url),"utf8"),JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json",import.meta.url),"utf8")));await db.account.createMany({data:plan});
    const all=await db.account.findMany(),cash=all.find(a=>a.reportGroup==="CASH_BANK")!,revenue=all.find(a=>a.mainType==="REVENUE"&&!a.isContra)!,cogs=all.find(a=>a.mainType==="COGS")!,expense=all.find(a=>a.mainType==="EXPENSE"&&a.reportGroup==="OPERATING_EXPENSE")!,retained=all.find(a=>a.reportGroup==="RETAINED_EARNINGS")!;
    for(const year of[2037,2038,2039])await executeJournalCommand(db,admin.id,"CREATE_YEAR",{year,requestKey:randomUUID()});
    const draft=(date:string,lines:{accountId:string;debit:string;credit:string}[])=>executeJournalCommand(db,admin.id,"CREATE_DRAFT",{date,description:"Jurnal sintetis uji laporan",lines,requestKey:randomUUID()});
    const post=async(date:string,debitId:string,creditId:string,amount:string)=>{const row=await draft(date,[{accountId:debitId,debit:amount,credit:"0"},{accountId:creditId,debit:"0",credit:amount}]);return executeJournalCommand(db,admin.id,"POST",{id:row.id,version:row.version,requestKey:randomUUID()});};
    const report=(year:number,from=year+"-01-01",to=year+"-12-31")=>financialReport(db,{year,from,to});
    let first:CommandResult,closingJournal:CommandResult;
    await t.test("buku baru nol, tanpa source journal atau saldo contoh",async()=>{const value=await report(2037);assert.equal(value.income.netProfit,"0");assert.equal(value.balance.totalAssets,"0");assert.equal(value.sourceCount,0);assert.equal(value.diagnostics.canUse,true);});
    await t.test("10 juta - 6 juta - 1 juta = laba3 juta; Neraca seimbang, draf diabaikan",async()=>{
      first=await post("2037-01-15",cash.id,revenue.id,"10000000");await post("2037-02-15",cogs.id,cash.id,"6000000");await post("2037-03-15",expense.id,cash.id,"1000000");await draft("2037-04-01",[{accountId:cash.id,debit:"99000000",credit:"0"},{accountId:revenue.id,debit:"0",credit:"99000000"}]);
      const value=await report(2037);assert.equal(value.income.grossProfit,"4000000");assert.equal(value.income.netProfit,"3000000");assert.equal(value.balance.totalAssets,"3000000");assert.equal(value.balance.currentProfit,"3000000");assert.equal(value.balance.difference,"0");assert.equal(value.sourceCount,3);assert.equal(value.diagnostics.canUse,true);assert.equal(value.sources[0].journalNumber,first.journalNumber);
    });
    await t.test("range Laba Rugi berbeda dari Neraca kumulatif dan saldo awal buku besar",async()=>{
      const value=await report(2037,"2037-02-01","2037-03-31");assert.equal(value.income.netProfit,"-7000000");assert.equal(value.balance.currentProfit,"3000000");assert.equal(value.balance.totalAssets,"3000000");
      const ledger=await ledgerReport(db,{accountId:cash.id,from:"2037-02-01",to:"2037-03-31"});assert.equal(ledger.opening,"10000000");assert.equal(ledger.rows[0].balance,"4000000");assert.equal(ledger.rows[1].balance,"3000000");assert.equal(ledger.closing,"3000000");
      const income=await financialReport(db,{year:2037,from:"2037-02-01",to:"2037-03-31"},{type:"profit"});assert.equal(income.sourceCount,2);
    });
    await t.test("year crossover meneruskan3 juta sekali dan laba tahun baru1,5 juta",async()=>{
      const empty=await report(2038);assert.equal(empty.balance.priorUnclosed,"3000000");assert.equal(empty.balance.totalEquity,"3000000");assert.equal(empty.income.netProfit,"0");
      await post("2038-01-15",cash.id,revenue.id,"2000000");await post("2038-02-15",expense.id,cash.id,"500000");const value=await report(2038);assert.equal(value.balance.priorUnclosed,"3000000");assert.equal(value.balance.currentProfit,"1500000");assert.equal(value.balance.totalAssets,"4500000");assert.equal(value.balance.difference,"0");
      const prior=await financialReport(db,{year:2038,from:"2038-01-01",to:"2038-12-31"},{component:"prior"});assert.equal(prior.sourceCount,3);assert.ok(prior.sources.every(source=>source.date<"2038-01-01"));
    });
    await t.test("pemindahan laba periode asal ke ekuitas tidak dihitung ganda; penutup manual ditandai",async()=>{
      const row=await draft("2037-12-31",[{accountId:revenue.id,debit:"10000000",credit:"0"},{accountId:cogs.id,debit:"0",credit:"6000000"},{accountId:expense.id,debit:"0",credit:"1000000"},{accountId:retained.id,debit:"0",credit:"3000000"}]);closingJournal=await executeJournalCommand(db,admin.id,"POST",{id:row.id,version:row.version,requestKey:randomUUID()});
      const value=await report(2038);assert.equal(value.balance.priorUnclosed,"0");assert.equal(value.balance.postedEquity,"3000000");assert.equal(value.balance.totalEquity,"4500000");assert.equal(value.balance.difference,"0");const closed=await report(2037);assert.equal(closed.diagnostics.manualClosingCount,1);assert.equal(closed.diagnostics.canUse,false);
    });
    await t.test("kontra dan OTHER_RESULT neto serta beban pajak mengikuti mapping disahkan",async()=>{
      const discount=all.find(a=>a.reportGroup==="CONTRA_REVENUE")!,result=all.find(a=>a.mainType==="OTHER_RESULT")!,tax=all.find(a=>a.reportGroup==="INCOME_TAX_EXPENSE")!;
      await post("2039-01-01",cash.id,revenue.id,"1000000");await post("2039-01-02",discount.id,cash.id,"100000");await post("2039-01-03",cash.id,result.id,"300000");await post("2039-01-04",result.id,cash.id,"50000");await post("2039-01-05",tax.id,cash.id,"75000");const value=await report(2039);assert.equal(value.income.totalRevenue,"900000");assert.equal(value.income.otherResult,"250000");assert.equal(value.income.netProfit,"1075000");assert.equal(value.balance.difference,"0");
    });
    await t.test("tiga kontrol direkonsiliasi per tanggal, nomor bisnis/JRN tersimpan tersedia",async()=>{
      const loan=await executeLoanCommand(db,admin.id,"CREATE_LOAN",{employeeName:"Karyawan sintetis",date:"2039-02-01",amount:"2000000",cashAccountId:cash.id,requestKey:randomUUID()});await executeLoanCommand(db,admin.id,"CREATE_PAYMENT",{loanId:loan.id,date:"2039-02-02",amount:"500000",cashAccountId:cash.id,requestKey:randomUUID()});
      const r=await executeTradeCommand(db,admin.id,"RECEIVABLE","CREATE_DOCUMENT",{partyName:"Customer sintetis",date:"2039-02-01",amount:"5000000",counterAccountId:revenue.id,requestKey:randomUUID()});await executeTradeCommand(db,admin.id,"RECEIVABLE","CREATE_PAYMENT",{documentId:r.id,date:"2039-02-02",amount:"2000000",cashAccountId:cash.id,requestKey:randomUUID()});
      const p=await executeTradeCommand(db,admin.id,"PAYABLE","CREATE_DOCUMENT",{partyName:"Supplier sintetis",date:"2039-02-01",amount:"4000000",counterAccountId:expense.id,requestKey:randomUUID()});await executeTradeCommand(db,admin.id,"PAYABLE","CREATE_PAYMENT",{documentId:p.id,date:"2039-02-02",amount:"1500000",cashAccountId:cash.id,requestKey:randomUUID()});
      const value=await report(2039);for(const [code,amount]of[["1122.1","1500000"],["1121.1","3000000"],["2110.1","2500000"]]){const row=value.diagnostics.reconciliations.find(item=>item.code===code)!;assert.equal(row.control,amount);assert.equal(row.detail,amount);assert.equal(row.difference,"0");}assert.equal(value.balance.difference,"0");
      const refs=value.sources.map(source=>source.businessNumber).filter(Boolean).join(" ");for(const prefix of["PJM","CIC","PIU","BYC","UTG","BYS"])assert.ok(refs.includes(prefix+"-"));
      const ledger=await ledgerReport(db,{accountId:cash.id,from:"2039-02-01",to:"2039-02-28"},{exportAll:true});assert.ok(ledger.rows.some(row=>row.businessNumber?.startsWith("CIC-")));
      if(process.env.REPORT_WRITE_QA==="SYNTHETIC_ONLY"){
        const directory=resolve(process.cwd(),".npm-cache/report-qa");mkdirSync(directory,{recursive:true});
        writeFileSync(join(directory,"snapshot.json"),JSON.stringify({report:value,ledger,filter:{from:"2039-02-01",to:"2039-02-28",yearLabel:"Tahun 2039 (Terbuka)"}},null,2));
      }
    });
    await t.test("pembalik bertanggal berikutnya menjaga laporan historis dan tidak membuat nomor saat baca",async()=>{
      const original=await post("2039-03-01",cash.id,revenue.id,"123");const before=await report(2039,"2039-01-01","2039-03-01");await executeJournalCommand(db,admin.id,"REVERSE",{id:original.id,version:original.version,date:"2039-03-02",reason:"Koreksi sintetis",requestKey:randomUUID()});const historical=await report(2039,"2039-01-01","2039-03-01");assert.deepEqual(historical.balance,before.balance);const n=await db.journalNumber.count();const x=await report(2039),y=await report(2039);assert.equal(await db.journalNumber.count(),n);assert.deepEqual(x.sources,y.sources);assert.ok(x.sources.some(row=>row.journalNumber===original.journalNumber));
      const prior=await report(2038);await executeJournalCommand(db,admin.id,"REVERSE",{id:closingJournal.id,version:closingJournal.version,date:"2039-03-03",reason:"Uji pembalik penutup manual",requestKey:randomUUID()});assert.deepEqual((await report(2038)).balance,prior.balance);assert.equal((await report(2037)).diagnostics.manualClosingCount,1);assert.equal((await report(2039)).diagnostics.manualClosingCount,1);
    });
    await t.test("locking menolak post tetapi laporan/PDF data tetap dapat dibaca",async()=>{
      const year=await db.fiscalYear.findUniqueOrThrow({where:{year:2039}});await executeJournalCommand(db,admin.id,"SET_YEAR_STATUS",{id:year.id,version:year.version,status:"LOCKED",reason:"Uji laporan terkunci",requestKey:randomUUID()});await assert.rejects(post("2039-04-01",cash.id,revenue.id,"1"),/terkunci/);const value=await report(2039);assert.equal(value.year.status,"LOCKED");assert.equal(value.balance.difference,"0");await assert.rejects(report(2039,"2038-12-31","2039-01-31"));
    });
  }finally{await isolated.cleanup();}
});
