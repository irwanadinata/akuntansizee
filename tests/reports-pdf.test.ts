import assert from "node:assert/strict";
import test from "node:test";
import { renderFinancialPdf,renderLedgerPdf } from "../src/lib/reports/pdf";
import { syntheticReport,syntheticLedger } from "./fixtures/report";
test("PDF Neraca/Laba Rugi/gabungan valid, nomor input tetap dan object tidak dimutasi",async()=>{
  const report=syntheticReport(),before=JSON.stringify(report);
  for(const type of["balance","profit","combined"]as const){const bytes=await renderFinancialPdf(report,type,{testNotice:true});assert.equal(bytes.subarray(0,4).toString(),"%PDF");assert.ok(bytes.length>3000);assert.ok(bytes.subarray(-30).toString().includes("%%EOF"));assert.equal(JSON.stringify(report),before);assert.ok((bytes.toString("latin1").match(/\/Type \/Page\b/g)??[]).length<=4,"footer tidak boleh menghasilkan halaman kosong tambahan");}
});
test("PDF ledger menerima angka20digit tanpa float; peringatan dapat dicetak",async()=>{
  const ledger=syntheticLedger(),before=JSON.stringify(ledger),bytes=await renderLedgerPdf(ledger,{from:"2037-01-01",to:"2037-12-31",yearLabel:"Tahun2037 (Terkunci)"},{testNotice:true});assert.equal(bytes.subarray(0,4).toString(),"%PDF");assert.equal(JSON.stringify(ledger),before);
  const warning=syntheticReport();warning.diagnostics.warnings=["SIMULASI UJI: selisih1, bukan laporan final"];warning.diagnostics.canUse=false;assert.ok((await renderFinancialPdf(warning,"combined",{testNotice:true})).length>3000);
});
test("glyph yang tidak didukung ditolak, tidak mengganti nama secara diam-diam",async()=>{
  const report=syntheticReport();report.balance.assets[0].rows[0].name="漢字";await assert.rejects(renderFinancialPdf(report,"balance"),/karakter/);
});
