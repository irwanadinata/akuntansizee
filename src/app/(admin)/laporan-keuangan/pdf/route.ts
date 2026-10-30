import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { financialReport } from "@/lib/reports/engine";
import { reportParameters } from "@/lib/reports/parameters";
import { ReportError } from "@/lib/reports/validation";
import { renderFinancialPdf,renderLedgerPdf } from "@/lib/reports/pdf";
import { ledgerReport } from "@/lib/ledger/report";
import { ledgerParameters } from "@/lib/ledger/parameters";
import { JournalError } from "@/lib/journal/validation";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  await requireAdmin();
  const params=Object.fromEntries(new URL(request.url).searchParams);
  try{
    const type=z.enum(["balance","profit","combined","ledger"]).parse(params.type??"combined");
    let bytes:Buffer,filename:string;
    if(type==="ledger"){
      const context=await ledgerParameters(params),report=await ledgerReport(getPrisma(),context.raw,{exportAll:true});
      bytes=await renderLedgerPdf(report,{from:context.raw.from,to:context.raw.to,yearLabel:report.year?"Tahun "+report.year.year+" ("+(report.year.status==="OPEN"?"Terbuka":"Terkunci")+")":"Lintas tahun"});
      filename="zee-buku-besar-"+report.account.code.replace(/[^a-zA-Z0-9._-]/g,"_")+"-"+context.raw.to+".pdf";
    }else{
      const context=await reportParameters(params),report=await financialReport(getPrisma(),context.filter,{type,exportAll:true});
      bytes=await renderFinancialPdf(report,type);filename="zee-"+type+"-"+report.filter.to+".pdf";
    }
    return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/pdf","Content-Disposition":'attachment; filename="'+filename+'"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(error){
    const message=error instanceof ReportError||error instanceof JournalError?error.message:error instanceof z.ZodError?error.issues[0]?.message:"PDF belum dapat dibuat. Periksa koneksi dan konfigurasi laporan.";
    return Response.json({error:message},{status:error instanceof ReportError||error instanceof JournalError||error instanceof z.ZodError?400:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
