import { FilterSubmitButton } from "@/components/loading/filter-content";
import Link from "@/components/year-link";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { withFiscalYear } from "@/lib/fiscal/context";
import { loanFilters,loanList } from "@/lib/loans/queries";
import { loanReconciliation } from "@/lib/loans/balances";
import { formatRupiah } from "@/lib/accounting/money";
import { displayDate } from "@/lib/accounting/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterBar, filterSelectClass } from "@/components/filter-bar";
import { CreationLink } from "@/components/transactions/creation-link";
export const metadata={title:"Pinjaman Karyawan"};
export default async function LoansPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await requireAdmin(); const params=await searchParams,scope=await withFiscalYear(params);const filters=loanFilters.parse({...params,year:scope.year}),db=getPrisma();
  const [result,years,reconciliation]=await Promise.all([loanList(db,filters),db.fiscalYear.findMany({orderBy:{year:"desc"}}),loanReconciliation(db)]);
  const link=(page:number)=>"/pinjaman-karyawan?"+new URLSearchParams({...filters,year:filters.year||"all",page:String(page)});
  return <div className="space-y-6"><header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Pinjaman Karyawan</h1><p className="mt-2 text-sm text-muted-foreground">Catat uang yang dipinjam karyawan dan cicilan yang diterima. Sisa dihitung otomatis.</p></div><Button asChild><CreationLink kind="loan">+ Catat Pinjaman</CreationLink></Button></header>
    <div className="rounded-xl border bg-card p-5"><p className="text-sm text-muted-foreground">Sisa seluruh pinjaman yang tercatat</p><p className="mt-2 text-2xl font-semibold">{formatRupiah(reconciliation.detail)}</p><p className="mt-2 text-sm text-muted-foreground">{reconciliation.difference==="0"?"Rincian cocok dengan saldo Piutang Karyawan.":"Rincian berbeda dengan akun kontrol. Hubungi pengelola untuk pemeriksaan; tidak ada penyeimbang otomatis."}</p></div>
    <FilterBar actions={<><Button variant="outline" asChild><Link href="/pinjaman-karyawan">Reset</Link></Button><FilterSubmitButton>Terapkan</FilterSubmitButton></>}>
      <div className="space-y-2"><Label htmlFor="q">Cari nama atau nomor</Label><Input id="q" name="q" defaultValue={filters.q} placeholder="Nama, nomor pinjaman/cicilan" maxLength={100}/></div>
      <div className="space-y-2"><Label htmlFor="year">Tahun pinjam</Label><select id="year" name="year" className={filterSelectClass} defaultValue={filters.year||"all"}><option value="all">Semua tahun</option>{years.map(year=><option key={year.id}>{year.year}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="status">Status</Label><select id="status" name="status" className={filterSelectClass} defaultValue={filters.status}><option value="all">Semua status</option><option value="unpaid">Belum Lunas</option><option value="paid">Lunas</option><option value="cancelled">Dibatalkan</option></select></div>
    </FilterBar>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-muted"><tr>{["Tanggal", "Karyawan / nomor pinjaman", "Dipinjam", "Sudah dicicil", "Sisa pinjaman", "Status"].map(title=><th className="p-4" key={title}>{title}</th>)}</tr></thead><tbody>{result.rows.map(loan=><tr key={loan.id} className="border-t"><td className="p-4">{displayDate(loan.date)}</td><td className="p-4"><Link className="font-semibold text-primary underline" href={"/pinjaman-karyawan/"+loan.id}>{loan.employeeName}</Link><p className="mt-1 font-mono text-xs">{loan.loanNumber}</p></td><td className="p-4 text-right tabular-nums">{formatRupiah(loan.amount)}</td><td className="p-4 text-right tabular-nums">{formatRupiah(loan.paid)}</td><td className="p-4 text-right font-semibold tabular-nums">{formatRupiah(loan.remaining)}</td><td className="p-4">{loan.reversalEntryId?"Dibatalkan":loan.remaining==="0"?"Lunas":"Belum Lunas"}</td></tr>)}</tbody></table>{!result.rows.length&&<div className="space-y-2 p-10 text-center"><h2 className="font-semibold">Belum ada pinjaman yang sesuai</h2><p className="text-sm text-muted-foreground">Catat pinjaman pertama atau sesuaikan pencarian. Tidak ada transaksi contoh.</p></div>}<nav aria-label="Halaman pinjaman" className="flex justify-between border-t p-4 text-sm"><span>{result.total} pinjaman · Halaman {result.page} dari {result.pages}</span><div className="flex gap-4">{result.page>1&&<Link href={link(result.page-1)}>Sebelumnya</Link>}{result.page<result.pages&&<Link href={link(result.page+1)}>Berikutnya</Link>}</div></nav></div>
    <p className="text-sm text-muted-foreground">Sisa mencakup semua catatan terposting beserta pembaliknya. Tahun menyaring tanggal pinjaman; histori saldo per tanggal tersedia di Buku Besar.</p>
  </div>;
}
