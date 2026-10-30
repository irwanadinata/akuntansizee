import Link from "@/components/year-link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { reportParameters,type SearchParams } from "@/lib/reports/parameters";
import { financialReport } from "@/lib/reports/engine";
import { ReportError } from "@/lib/reports/validation";
import { SourceJournals } from "@/components/reports/financial-view";
import { formatRupiah } from "@/lib/accounting/money";
export const metadata={title:"Rincian hasil usaha"};
async function loadDetail(params:SearchParams){
  try{
    const context=await reportParameters(params),part=z.enum(["prior","current"]).catch("current").parse(params.part),page=z.coerce.number().int().min(1).max(100000).catch(1).parse(params.sourcePage);
    return{ok:true as const,part,report:await financialReport(getPrisma(),context.filter,{component:part,sourcePage:page})};
  }catch(error){
    if(error instanceof z.ZodError)return{ok:false as const,message:error.issues[0]?.message??"Filter tidak sah."};
    if(error instanceof ReportError)return{ok:false as const,message:error.message};
    throw error;
  }
}
export default async function EarningsDetail({searchParams}:{searchParams:Promise<SearchParams>}){
  await requireAdmin();const result=await loadDetail(await searchParams);
  if(!result.ok)return <div className="space-y-4"><h1 className="text-2xl font-semibold">Rincian hasil usaha</h1><p role="alert">{result.message}</p><Link className="text-primary underline" href="/neraca">Kembali ke Neraca</Link></div>;
  const{part,report}=result,prior=part==="prior";
  const rows=report.accounts.filter(account=>["REVENUE","COGS","EXPENSE","OTHER_RESULT"].includes(account.mainType)&&(prior?account.prior:account.yearToDate)!=="0");
  const query=new URLSearchParams({year:String(report.year.year),from:report.filter.from,to:report.filter.to,part});
  return <div className="space-y-6"><Link className="text-primary underline" href={"/neraca?"+query}>Kembali ke Neraca</Link><h1 className="text-2xl font-semibold">{prior?"Sisa hasil usaha sebelum "+report.year.year:"Hasil usaha tahun "+report.year.year}</h1><p className="text-sm text-muted-foreground">{prior?"Neto akun hasil usaha sebelum awal tahun terpilih, termasuk efek jurnal penutup yang benar-benar terposting pada tanggal tersebut.":"Hasil usaha dari awal tahun terpilih sampai tanggal Neraca. Rentang Laba Rugi terpisah dapat menghasilkan jumlah lain."} Ini penyajian saldo jurnal, bukan pembuatan akun atau saldo baru.</p><p className="text-xl font-semibold">{formatRupiah(prior?report.balance.priorUnclosed:report.balance.currentProfit)}</p><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="bg-muted"><tr><th className="p-3">Akun</th><th className="p-3 text-right">Kontribusi hasil usaha</th></tr></thead><tbody>{rows.map(row=><tr key={row.id} className="border-t"><td className="p-3"><Link className="text-primary underline" href={"/buku-besar?"+new URLSearchParams({accountId:row.id,year:prior?"all":String(report.year.year),from:prior?"1900-01-01":report.year.year+"-01-01",to:prior?(report.year.year-1)+"-12-31":report.filter.to})}>{row.code} · {row.name}</Link></td><td className="p-3 text-right tabular-nums">{formatRupiah(-BigInt(prior?row.prior:row.yearToDate))}</td></tr>)}</tbody></table>{!rows.length&&<p className="p-5 text-sm">Tidak ada sisa hasil usaha dalam cakupan ini.</p>}</div><SourceJournals report={report} path="/laporan-keuangan/rincian" params={query}/></div>;
}
