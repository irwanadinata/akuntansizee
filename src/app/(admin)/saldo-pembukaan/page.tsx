import Link from "@/components/year-link";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { withFiscalYear } from "@/lib/fiscal/context";
import { displayDate,displayTime } from "@/lib/accounting/dates";
import { openingChoices } from "@/lib/opening/queries";
import { OpeningForm } from "@/components/opening/opening-form";
import type { SearchParams } from "@/lib/reports/parameters";
export const metadata={title:"Saldo Pembukaan (Opsional)"};
export default async function OpeningPage({searchParams}:{searchParams:Promise<SearchParams>}){
  await requireAdmin();const db=getPrisma(),scope=await withFiscalYear(await searchParams,false);
  const marker=await db.openingJournal.findUnique({where:{singletonKey:1},include:{journalEntry:{include:{reversal:true}},fiscalYear:true,createdBy:{select:{email:true}}}});
  const year=scope.years.find(year=>String(year.year)===scope.year);
  const accounts=marker?[]:await openingChoices(db);
  return <div className="space-y-6"><header className="space-y-2"><h1 className="text-2xl font-semibold">Saldo Pembukaan <span className="text-base text-muted-foreground">(Opsional)</span></h1><p className="text-sm">Isi saldo pembukaan langsung per COA tanpa akun lawan. Buku baru boleh langsung mulai dari Rp0.</p></header>{marker?<section className="space-y-3 rounded-xl border bg-card p-6"><h2 className="text-xl font-semibold">Pembukaan perusahaan sudah tercatat</h2><Link className="break-all font-mono text-primary underline" href={"/jurnal/"+marker.journalEntryId}>{marker.journalEntry.journalNumber}</Link><p>{marker.perAccount?"Saldo per COA tanpa akun lawan · ":""}Cutover {displayDate(marker.cutoverDate)} · Tahun {marker.fiscalYear.year} · {marker.journalEntry.status==="REVERSED"?"Dibatalkan dengan pembalik":"Terposting"}</p><p className="text-sm">Disetujui {displayTime(marker.confirmedAt)} oleh {marker.createdBy.email}.</p><p className="text-sm">Rujukan verifikasi: {marker.verificationNote}</p><p className="text-sm text-muted-foreground">Pembukaan berlaku untuk seluruh perusahaan dan lintas tahun. Untuk koreksi saldo atau menambah COA, buka rincian saldo pembukaan lalu pilih Ubah jurnal.</p>{marker.journalEntry.reversal&&<Link className="text-primary underline" href={"/jurnal/"+marker.journalEntry.reversal.id}>Lihat jurnal pembalik {marker.journalEntry.reversal.journalNumber}</Link>}</section>:year?<OpeningForm key={year.id} accounts={accounts} year={year}/>:<p className="rounded-xl border p-6">Belum ada Tahun Buku. <Link className="text-primary underline" href="/tahun-buku">Tambahkan tahun terbuka</Link> bila ingin memakai saldo pembukaan; tidak ada saldo dibuat otomatis.</p>}</div>;
}
