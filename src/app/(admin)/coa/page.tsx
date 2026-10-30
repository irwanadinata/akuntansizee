import { FilterSubmitButton } from "@/components/loading/filter-content";
import type { Metadata } from "next";
import Link from "@/components/year-link";
import { Plus, Search } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { listAccounts, coaFilterSchema } from "@/lib/coa/queries";
import { mainTypes, typeLabels, groupLabel } from "@/lib/coa/catalog";
import { AccountActions } from "@/components/coa/account-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterBar, filterSelectClass } from "@/components/filter-bar";
import { CreationLink } from "@/components/transactions/creation-link";
export const metadata: Metadata = { title: "Daftar Akun (COA)" };
export const dynamic = "force-dynamic";
const selectClass = filterSelectClass;
export default async function CoaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const raw=await searchParams,year=typeof raw.year==="string"?raw.year:undefined;
  const filters = coaFilterSchema.parse(raw);
  const result = await listAccounts(filters);
  function pageLink(page: number) {
    const params = new URLSearchParams({ q: filters.q, type: filters.type, status: filters.status, review: filters.review, page: String(page) });
    return "/coa?" + params.toString();
  }
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Daftar Akun (COA)</h1><p className="mt-2 text-sm text-muted-foreground">Kelola kode dan kelompok akun pembukuan perusahaan.</p></div><Button asChild><CreationLink kind="account"><Plus aria-hidden="true" />Tambah akun</CreationLink></Button></header>
    <FilterBar columns={4} actions={<><Button asChild variant="outline"><Link href="/coa">Reset</Link></Button><FilterSubmitButton><Search aria-hidden="true" />Terapkan</FilterSubmitButton></>}>
      {year!==undefined&&<input type="hidden" name="year" value={year}/>}
      <div className="space-y-2"><Label htmlFor="q">Cari akun</Label><Input id="q" name="q" placeholder="Kode, nama, keterangan" defaultValue={filters.q} maxLength={100} /></div>
      <div className="space-y-2"><Label htmlFor="type">Jenis</Label><select id="type" name="type" defaultValue={filters.type} className={selectClass}><option value="">Semua jenis</option>{mainTypes.map(type => <option key={type} value={type}>{typeLabels[type]}</option>)}</select></div>
      <div className="space-y-2"><Label htmlFor="status">Status</Label><select id="status" name="status" defaultValue={filters.status} className={selectClass}><option value="all">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></div>
      <div className="space-y-2"><Label htmlFor="review">Pemeriksaan</Label><select id="review" name="review" defaultValue={filters.review} className={selectClass}><option value="all">Semua</option><option value="pending">Perlu diperiksa</option><option value="reviewed">Sudah diperiksa</option></select></div>
    </FilterBar>
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap justify-between gap-2 border-b p-4 text-sm"><span>{result.total} akun ditemukan</span><span className="text-muted-foreground">Saldo tidak diubah melalui daftar akun.</span></div>
      {result.accounts.length === 0 ? <div className="p-10 text-center"><h2 className="font-semibold">Belum ada akun yang sesuai</h2><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">Tambahkan akun atau sesuaikan pencarian. Pengelola dapat menjalankan seed daftar COA yang sudah disahkan.</p></div> :
        <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-left text-sm"><thead className="border-b bg-muted"><tr>{["Kode", "Nama & keterangan", "Jenis / kelompok", "Saldo normal", "Status / review", "Tindakan"].map(title => <th key={title} scope="col" className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead>
          <tbody>{result.accounts.map(account => <tr key={account.id} className="border-b last:border-0">
            <td className="px-4 py-4 align-top font-mono">{account.code}</td>
            <td className="max-w-xs px-4 py-4 align-top"><Link href={"/coa/" + account.id} className="font-semibold text-primary hover:underline">{account.name}</Link>{account.description && <p className="mt-1 line-clamp-2 text-muted-foreground">{account.description}</p>}{account.isContra && <p className="mt-1">Kontra akun</p>}{account.isControlAccount && <p className="mt-1">Akun kontrol</p>}</td>
            <td className="px-4 py-4 align-top">{typeLabels[account.mainType]}<p className="mt-1 text-muted-foreground">{groupLabel(account.reportGroup)}</p></td>
            <td className="px-4 py-4 align-top">{account.normalBalance === "DEBIT" ? "Debit" : "Kredit"}</td>
            <td className="px-4 py-4 align-top"><span className={account.isActive ? "text-primary" : "text-muted-foreground"}>{account.isActive ? "Aktif" : "Nonaktif"}</span>{(account.requiresReview || account.reviewedAt) && <p className={"mt-2 " + (account.reviewedAt ? "text-muted-foreground" : "font-semibold text-amber-800")}>{account.reviewedAt ? "Sudah diperiksa" : "Perlu diperiksa"}</p>}</td>
            <td className="px-4 py-4 align-top"><AccountActions id={account.id} version={account.version} code={account.code} active={account.isActive} canDelete={!account.usedAt && account._count.usageRecords === 0} /></td>
          </tr>)}</tbody></table></div>}
      <nav aria-label="Halaman daftar akun" className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"><span>Halaman {result.page} dari {result.pages}</span><div className="flex gap-2">{result.page > 1 && <Button asChild size="sm" variant="outline"><Link href={pageLink(result.page - 1)}>Sebelumnya</Link></Button>}{result.page < result.pages && <Button asChild size="sm" variant="outline"><Link href={pageLink(result.page + 1)}>Berikutnya</Link></Button>}</div></nav>
    </div>
    <p className="text-sm text-muted-foreground">Akun yang pernah digunakan hanya dapat dinonaktifkan. Akun nonaktif tetap disimpan untuk laporan historis. Lihat saldo dan mutasi melalui Buku Besar.</p>
  </div>;
}

