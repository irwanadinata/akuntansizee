import { DownloadPdfButton } from "@/components/reports/download-pdf-button";
import Link from "@/components/year-link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { ledgerFilters,ledgerReport } from "@/lib/ledger/report";
import { ledgerParameters } from "@/lib/ledger/parameters";
import { displayDate } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";
import { JournalError,businessDate } from "@/lib/journal/validation";
import type { SearchParams } from "@/lib/reports/parameters";
import { COMPANY_NAME } from "@/lib/reports/validation";
import { PeriodFilters } from "@/components/reports/period-filters";
import { PrintButton } from "@/components/reports/print-button";
export const metadata={title:"Buku Besar"};
export default async function LedgerPage({searchParams}:{searchParams:Promise<SearchParams>}){
  await requireAdmin();const db=getPrisma(),params=await searchParams,context=await ledgerParameters(params);
  if(params.fiscalYearId&&!params.year&&context.year){const canonical=new URLSearchParams();for(const[key,value]of Object.entries(params))if(typeof value==="string"&&key!=="fiscalYearId")canonical.set(key,value);canonical.set("year",context.year);redirect("/buku-besar?"+canonical);}
  const accounts=await db.account.findMany({orderBy:{code:"asc"},select:{id:true,code:true,name:true}}),parsed=ledgerFilters.safeParse(context.raw);
  let report:Awaited<ReturnType<typeof ledgerReport>>|undefined,error="";
  if(context.raw.accountId){if(!parsed.success)error=parsed.error.issues[0]?.message??"Filter tidak sah.";else try{report=await ledgerReport(db,parsed.data);}catch(caught){if(caught instanceof JournalError)error=caught.message;else throw caught;}}
  const query=new URLSearchParams({accountId:context.raw.accountId,year:context.year||"all",from:context.raw.from,to:context.raw.to});
  const fromLabel=businessDate.safeParse(context.raw.from).success?displayDate(context.raw.from):"Tanggal awal tidak sah",toLabel=businessDate.safeParse(context.raw.to).success?displayDate(context.raw.to):"Tanggal akhir tidak sah";
  const pageLink=(page:number)=>"/buku-besar?"+query+"&page="+page;
  return <div className="ledger-report space-y-6"><header><p className="text-sm font-semibold text-primary">{COMPANY_NAME}</p><h1 className="mt-2 text-2xl font-semibold">Buku Besar</h1><p className="mt-2 text-sm">{context.year?"Tahun "+context.year:"Lintas tahun"}{report?.year?" · "+(report.year.status==="OPEN"?"Terbuka":"Terkunci"):""} · {fromLabel} - {toLabel}</p><p className="mt-2 text-sm text-muted-foreground">Saldo berasal dari jurnal terposting, termasuk asal dan pembalik sesuai tanggal. Draf tidak masuk perhitungan.</p></header>
    <PeriodFilters key={query.toString()} action="/buku-besar" years={context.years} year={context.year} from={context.raw.from} to={context.raw.to} ledger accounts={accounts} accountId={context.raw.accountId}/>
    <p className="text-sm text-muted-foreground">Saldo awal mencakup seluruh jurnal sebelum tanggal awal, termasuk tahun sebelumnya. Kontra akun disajikan sesuai saldo normalnya; kontribusi pengurangnya terlihat pada Neraca/Laba Rugi.</p>
    {error&&<p role="alert" className="rounded-lg border p-4 text-destructive">{error}</p>}{!report&&!error&&<div className="rounded-xl border p-10 text-center">Pilih akun dan periode untuk melihat mutasi serta saldo berjalan.</div>}
    {report&&<><div data-print-hide className="flex flex-wrap gap-3"><PrintButton/><DownloadPdfButton href={"/laporan-keuangan/pdf?"+query+"&type=ledger"}>Unduh PDF lengkap</DownloadPdfButton></div><p className="text-sm">{report.account.code} · {report.account.name} · Saldo normal {report.account.normalBalance==="DEBIT"?"Debit":"Kredit"}{report.account.isContra?" · Kontra akun":""}</p><div className="grid gap-4 sm:grid-cols-3">{[["Saldo awal",report.opening],["Total debit / kredit",formatRupiah(report.debit)+" / "+formatRupiah(report.credit)],["Saldo akhir",report.closing]].map(([label,value])=><div key={label} className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 font-semibold">{label==="Total debit / kredit"?value:formatRupiah(value)}</p></div>)}</div><div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[920px] text-left text-sm"><thead className="bg-muted"><tr>{["Tanggal","Nomor jurnal / bisnis","Uraian","Debit","Kredit","Saldo berjalan"].map(label=><th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{report.rows.map(row=><tr key={row.id} className="border-t"><td className="whitespace-nowrap p-3">{displayDate(row.date)}</td><td className="p-3"><Link className="font-mono text-primary underline" href={"/jurnal/"+row.entryId}>{row.journalNumber}</Link>{row.businessNumber&&<p className="mt-1 font-mono text-xs">{row.businessNumber}</p>}{row.parentNumber&&<p className="mt-1 font-mono text-xs">{row.parentNumber}</p>}</td><td className="p-3">{row.description}</td>{[row.debit,row.credit,row.balance].map((amount,i)=><td key={i} className={"p-3 text-right tabular-nums "+(i===2?"font-semibold":"")}>{formatRupiah(amount)}</td>)}</tr>)}</tbody></table>{!report.rows.length&&<p className="p-10 text-center text-sm">Tidak ada jurnal terposting pada rentang ini. Saldo awal tetap diperhitungkan.</p>}<nav data-print-hide aria-label="Halaman Buku Besar" className="flex justify-between border-t p-4 text-sm"><span>{report.count} baris · Halaman {report.page} dari {report.pages}</span><div className="flex gap-4">{report.page>1&&<Link href={pageLink(report.page-1)}>Sebelumnya</Link>}{report.page<report.pages&&<Link href={pageLink(report.page+1)}>Berikutnya</Link>}</div></nav></div><p className="text-sm text-muted-foreground">Cetak halaman hanya mencetak baris halaman ini. PDF lengkap mencakup seluruh baris periode (maksimal 5.000, tidak dipotong diam-diam).</p></>}
  </div>;
}
