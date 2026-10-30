import { FilterSubmitButton } from "@/components/loading/filter-content";
import Link from "@/components/year-link";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { withFiscalYear } from "@/lib/fiscal/context";
import { journalFilters, journalList } from "@/lib/journal/queries";
import { displayDate } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterBar, filterSelectClass } from "@/components/filter-bar";
export const metadata = { title: "Jurnal" };
export const dynamic = "force-dynamic";
export default async function JournalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const params=await searchParams,scope=await withFiscalYear(params);
  const filters = journalFilters.parse({...params,year:scope.year}), db = getPrisma();
  const result = await journalList(db, filters), years = await db.fiscalYear.findMany({ orderBy: { year: "desc" } });
  const link = (page: number) => "/jurnal?" + new URLSearchParams({ ...filters, page: String(page) });
  return <div className="space-y-6"><header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-semibold">Jurnal</h1><p className="mt-2 text-sm text-muted-foreground">Catatan debit dan kredit. Draf belum memengaruhi pembukuan.</p></div><Button asChild><Link href="/jurnal/baru">Jurnal manual (lanjutan)</Link></Button></header>
    <FilterBar actions={<><Button variant="outline" asChild><Link href="/jurnal">Reset</Link></Button><FilterSubmitButton>Terapkan</FilterSubmitButton></>}>
      <div className="space-y-2"><Label htmlFor="q">Cari nomor atau uraian</Label><Input id="q" name="q" placeholder="Nomor jurnal atau uraian transaksi" defaultValue={filters.q} maxLength={100} /></div>
      <div className="space-y-2"><Label htmlFor="status">Status jurnal</Label><select id="status" className={filterSelectClass} name="status" defaultValue={filters.status}><option value="">Semua status</option><option value="DRAFT">Draf</option><option value="POSTED">Terposting</option><option value="REVERSED">Dibatalkan dengan pembalik</option></select></div>
      <div className="space-y-2"><Label htmlFor="year">Tahun buku</Label><select id="year" className={filterSelectClass} name="year" defaultValue={filters.year || "all"}><option value="all">Semua tahun</option>{years.map(year => <option key={year.id}>{year.year}</option>)}</select></div>
    </FilterBar>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[750px] text-left text-sm"><thead className="bg-muted"><tr>{["Tanggal", "Nomor jurnal", "Uraian", "Status", "Total debit"].map(label => <th key={label} className="p-4">{label}</th>)}</tr></thead><tbody>{result.entries.map(entry => <tr key={entry.id} className="border-t"><td className="p-4">{displayDate(entry.date)}</td><td className="p-4"><Link className="font-mono text-primary underline" href={"/jurnal/" + entry.id}>{entry.journalNumber}</Link>{entry.sourceType === "REVERSAL" && <p className="mt-1 text-xs">Jurnal pembalik</p>}</td><td className="max-w-xs p-4">{entry.description}</td><td className="p-4">{entry.status === "DRAFT" ? "Draf" : entry.status === "POSTED" ? "Terposting" : "Dibatalkan dengan pembalik"}</td><td className="p-4 tabular-nums">{formatRupiah(entry.lines.reduce((sum, line) => sum + BigInt(line.debit.toFixed(0)), 0n))}</td></tr>)}</tbody></table>{!result.entries.length && <div className="p-10 text-center"><h2 className="font-semibold">Belum ada jurnal yang sesuai</h2><p className="mt-2 text-sm text-muted-foreground">Buku baru dimulai tanpa transaksi. Buat tahun buku dan periksa COA sebelum mencatat jurnal.</p></div>}<nav className="flex justify-between border-t p-4 text-sm" aria-label="Halaman jurnal"><span>{result.total} jurnal · Halaman {result.page} dari {result.pages}</span><div className="flex gap-4">{result.page > 1 && <Link href={link(result.page - 1)}>Sebelumnya</Link>}{result.page < result.pages && <Link href={link(result.page + 1)}>Berikutnya</Link>}</div></nav></div>
  </div>;
}
