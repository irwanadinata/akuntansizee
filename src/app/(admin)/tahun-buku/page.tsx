import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { displayDate, jakartaDate } from "@/lib/accounting/dates";
import { YearAction } from "@/components/journal/year-actions";
export const metadata = { title: "Tahun Buku" };
export default async function FiscalYearPage() {
  await requireAdmin(); const years = await getPrisma().fiscalYear.findMany({ orderBy: { year: "desc" } });
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Tahun Buku</h1><p className="mt-2 text-sm text-muted-foreground">Tahun terbuka menerima jurnal. Tahun terkunci menolak pembuatan, perubahan draf dan posting. Pembalik dapat dicatat pada periode terbuka berikutnya.</p></header><section className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">Tambah tahun kalender</h2><YearAction currentYear={Number(jakartaDate().slice(0, 4))} /><p className="text-sm text-muted-foreground">Membuat tahun tidak membuat saldo, jurnal pembukaan atau jurnal penutup.</p></section>{!years.length && <p className="rounded-xl border p-8 text-center">Belum ada tahun buku.</p>}{years.map(year => <section key={year.id} className="space-y-4 rounded-xl border bg-card p-5"><h2 className="font-semibold">{year.year} · {year.status === "OPEN" ? "Terbuka" : "Terkunci"}</h2><p className="text-sm">{displayDate(year.startDate)} – {displayDate(year.endDate)}</p><YearAction key={year.id + year.version} year={{ id: year.id, version: year.version, status: year.status }} /></section>)}</div>;
}
