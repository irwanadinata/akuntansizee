import Link from "@/components/year-link";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { withFiscalYear } from "@/lib/fiscal/context";
import { fiscalDate } from "@/lib/fiscal/selection";
import { jakartaDate,displayDate,displayTime } from "@/lib/accounting/dates";
import { assertOpeningAccount } from "@/lib/opening/validation";
import { OpeningForm } from "@/components/opening/opening-form";
import type { SearchParams } from "@/lib/reports/parameters";
export const metadata={title:"Saldo Pembukaan (Opsional)"};
export default async function OpeningPage({searchParams}:{searchParams:Promise<SearchParams>}){
  await requireAdmin();const db=getPrisma(),scope=await withFiscalYear(await searchParams,false);
  const marker=await db.openingJournal.findUnique({where:{singletonKey:1},include:{journalEntry:{include:{reversal:true}},fiscalYear:true,createdBy:{select:{email:true}}}});
  const year=scope.years.find(year=>String(year.year)===scope.year);
  const rows=marker?[]:await db.account.findMany({where:{isActive:true,isControlAccount:false,reviewedAt:{not:null}},orderBy:{code:"asc"}});
  const accounts=rows.filter(row=>{try{assertOpeningAccount(row);return true;}catch{return false;}}).map(({id,code,name,mainType,reportGroup,normalBalance,isContra,isControlAccount})=>({id,code,name,mainType,reportGroup,normalBalance,isContra,isControlAccount}));
  return <div className="space-y-6"><header className="space-y-2"><h1 className="text-2xl font-semibold">Saldo Pembukaan <span className="text-base text-muted-foreground">(Opsional)</span></h1><p className="text-sm">Cukup isi satu nominal saldo kas/bank awal dari modal pemilik. Buku baru boleh langsung mulai dari Rp0.</p></header>{marker?<section className="space-y-3 rounded-xl border bg-card p-6"><h2 className="text-xl font-semibold">Pembukaan perusahaan sudah tercatat</h2><Link className="break-all font-mono text-primary underline" href={"/jurnal/"+marker.journalEntryId}>{marker.journalEntry.journalNumber}</Link><p>Cutover {displayDate(marker.cutoverDate)} · Tahun {marker.fiscalYear.year} · {marker.journalEntry.status==="REVERSED"?"Dibatalkan dengan pembalik":"Terposting"}</p><p className="text-sm">Disetujui {displayTime(marker.confirmedAt)} oleh {marker.createdBy.email}.</p><p className="text-sm">Rujukan verifikasi: {marker.verificationNote}</p><p className="text-sm text-muted-foreground">Penanda pembukaan berlaku untuk seluruh perusahaan dan lintas tahun. Impor kedua tidak tersedia.</p>{marker.journalEntry.reversal&&<Link className="text-primary underline" href={"/jurnal/"+marker.journalEntry.reversal.id}>Lihat jurnal pembalik {marker.journalEntry.reversal.journalNumber}</Link>}</section>:year?<OpeningForm key={year.id} accounts={accounts} year={year} today={fiscalDate(String(year.year),jakartaDate())}/>:<p className="rounded-xl border p-6">Belum ada Tahun Buku. <Link className="text-primary underline" href="/tahun-buku">Tambahkan tahun terbuka</Link> bila ingin memakai saldo pembukaan; tidak ada saldo dibuat otomatis.</p>}</div>;
}
