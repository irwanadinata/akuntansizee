import { readFileSync,mkdirSync,writeFileSync } from "node:fs";
import { resolve,join } from "node:path";
import type { FinancialReport } from "../src/lib/reports/engine";
import type { ledgerReport } from "../src/lib/ledger/report";
import { renderFinancialPdf,renderLedgerPdf } from "../src/lib/reports/pdf";
import { syntheticLedger } from "../tests/fixtures/report";
const snapshot=JSON.parse(readFileSync(resolve(".npm-cache/report-qa/snapshot.json"),"utf8"))as{report:FinancialReport;ledger:Awaited<ReturnType<typeof ledgerReport>>;filter:{from:string;to:string;yearLabel:string}};
const output=resolve("output/pdf");mkdirSync(output,{recursive:true});
if(snapshot.report.sourceCount!==snapshot.report.sources.length)throw new Error("Snapshot QA harus memuat semua sumber.");
for(const type of["balance","profit","combined"]as const){
  const report=type==="profit"?{...snapshot.report,sources:snapshot.report.sources.filter(source=>source.date>=snapshot.report.filter.from),sourceScope:"period" as const}:snapshot.report;
  writeFileSync(join(output,"qa-"+type+".pdf"),await renderFinancialPdf({...report,sourceCount:report.sources.length},type,{testNotice:true}));
}
writeFileSync(join(output,"qa-ledger.pdf"),await renderLedgerPdf(snapshot.ledger,snapshot.filter,{testNotice:true}));
const mismatch=structuredClone(snapshot.report);mismatch.diagnostics.warnings=["SIMULASI UJI DIAGNOSTIK: terdapat selisih1. Ini bukan data perusahaan atau laporan final."];mismatch.diagnostics.canUse=false;mismatch.balance.difference="1";
writeFileSync(join(output,"qa-diagnostic.pdf"),await renderFinancialPdf(mismatch,"combined",{testNotice:true}));
// Extra intermediate precision sample for automated extraction, not a deliverable.
mkdirSync(resolve("tmp/pdfs"),{recursive:true});writeFileSync(resolve("tmp/pdfs/precision.pdf"),await renderLedgerPdf(syntheticLedger(),{from:"2037-01-01",to:"2037-12-31",yearLabel:"Tahun2037 (Terkunci)"},{testNotice:true}));
console.info("5 PDF QA sintetis di output/pdf; sampel presisi sementara dibuat. Tidak ada koneksi DB atau nomor baru.");
