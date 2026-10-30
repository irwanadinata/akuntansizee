import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { calculateStatements,type AccountTotals } from "../src/lib/reports/calculation";
import { reportFilters } from "../src/lib/reports/validation";
import { defaultFiscalYear,selectedYear,fiscalHref,fiscalDate } from "../src/lib/fiscal/selection";
const account=(mainType:string,reportGroup:string,net:string,extra:Partial<AccountTotals>={}):AccountTotals=>({id:randomUUID(),code:"9999.1",name:"Akun uji",mainType,reportGroup,normalBalance:["ASSET","COGS","EXPENSE"].includes(mainType)?"DEBIT":"CREDIT",isContra:false,isControlAccount:false,requiresReview:false,reviewed:true,cumulative:net,prior:"0",yearToDate:net,period:net,...extra});
test("laba 10 juta - HPP6 juta - beban1 juta =3 juta dan Neraca seimbang",()=>{
  const report=calculateStatements([account("ASSET","CASH_BANK","3000000"),account("REVENUE","OPERATING_REVENUE","-10000000"),account("COGS","COST_OF_SALES","6000000"),account("EXPENSE","OPERATING_EXPENSE","1000000")]);
  assert.equal(report.income.grossProfit,"4000000");assert.equal(report.income.netProfit,"3000000");assert.equal(report.balance.totalAssets,"3000000");assert.equal(report.balance.currentProfit,"3000000");assert.equal(report.balance.difference,"0");
});
test("saldo tahun sebelumnya diteruskan sekali; laba dipindahkan ke ekuitas tidak digandakan",()=>{
  const carried=calculateStatements([account("ASSET","CASH_BANK","4500000"),account("REVENUE","OPERATING_REVENUE","-4500000",{prior:"-3000000",yearToDate:"-1500000",period:"-1000000"})]);
  assert.equal(carried.balance.priorUnclosed,"3000000");assert.equal(carried.balance.currentProfit,"1500000");assert.equal(carried.income.netProfit,"1000000");assert.equal(carried.balance.difference,"0");
  const closed=calculateStatements([account("ASSET","CASH_BANK","4500000"),account("EQUITY","RETAINED_EARNINGS","-3000000",{prior:"-3000000",yearToDate:"0",period:"0"}),account("REVENUE","OPERATING_REVENUE","-1500000")]);
  assert.equal(closed.balance.priorUnclosed,"0");assert.equal(closed.balance.postedEquity,"3000000");assert.equal(closed.balance.totalEquity,"4500000");assert.equal(closed.balance.difference,"0");
});
test("kontra, dividen, hasil kurs/pelepasan aset neto dan pajak mengikuti mapping",()=>{
  const rows=[account("ASSET","FIXED_ASSET","1000000"),account("ASSET","FIXED_ASSET","-200000",{isContra:true,normalBalance:"CREDIT"}),account("REVENUE","OPERATING_REVENUE","-1000000"),account("REVENUE","CONTRA_REVENUE","100000",{isContra:true,normalBalance:"DEBIT"}),account("COGS","COST_OF_SALES","400000"),account("EXPENSE","OPERATING_EXPENSE","200000"),account("OTHER_RESULT","OTHER_RESULT","-250000"),account("EXPENSE","INCOME_TAX_EXPENSE","75000"),account("EQUITY","DIVIDENDS","50000",{isContra:true,normalBalance:"DEBIT"})];
  const report=calculateStatements(rows);assert.equal(report.income.totalRevenue,"900000");assert.equal(report.income.grossProfit,"500000");assert.equal(report.income.otherResult,"250000");assert.equal(report.income.beforeTax,"550000");assert.equal(report.income.netProfit,"475000");assert.equal(report.balance.totalAssets,"800000");assert.equal(report.balance.postedEquity,"-50000");assert.equal(report.mappingWarnings.length,0);
});
test("presisi agregat melewati Decimal per-baris; selisih dan mapping tak disembunyikan",()=>{
  const large="100000000000000000001";const report=calculateStatements([account("ASSET","CASH_BANK",large),account("EQUITY","CAPITAL","-100000000000000000000")]);assert.equal(report.balance.difference,"1");
  assert.equal(calculateStatements([account("ASSET","UNKNOWN","1")]).mappingWarnings.length,1);
  assert.equal(calculateStatements([account("ASSET","CASH_BANK","0",{requiresReview:true,reviewed:false})]).mappingWarnings.length,0);
  assert.equal(calculateStatements([account("ASSET","CASH_BANK","0",{requiresReview:true,reviewed:false,hasPosted:true})]).mappingWarnings.length,1);
});
test("range laporan harus sah dan satu Tahun Buku; pilihan tahun dan navigasi konsisten",()=>{
  assert.equal(reportFilters.safeParse({year:2038,from:"2037-12-31",to:"2038-01-31"}).success,false);assert.equal(reportFilters.safeParse({year:2038,from:"2038-02-30",to:"2038-03-01"}).success,false);
  const years=[{id:randomUUID(),year:2038,status:"LOCKED" as const},{id:randomUUID(),year:2037,status:"OPEN" as const}];
  assert.equal(defaultFiscalYear(years,"2037",2038),"2037");assert.equal(selectedYear("all",years,"2038",true),"");assert.equal(selectedYear("all",years,"2038",false),"2038");
  assert.equal(fiscalHref("/piutang-customer/baru","2037","2038"),"/piutang-customer/baru?year=2037");assert.equal(fiscalHref("/neraca","","2038"),"/neraca?year=2038");assert.equal(fiscalHref("?page=2","2037","2038","/pinjaman-karyawan/abc"),"/pinjaman-karyawan/abc?page=2&year=2037");assert.equal(fiscalHref("/buku-besar?year=all","2037","2038"),"/buku-besar?year=all");assert.equal(fiscalDate("2037","2038-10-01"),"2037-01-01");
});
