import Link from "@/components/year-link";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { withFiscalYear } from "@/lib/fiscal/context";
import { dateString, displayDate, displayTime } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";
import { openingChoices } from "@/lib/opening/queries";
import { OpeningForm } from "@/components/opening/opening-form";
import { JournalForm } from "@/components/journal/journal-form";
import type { SearchParams } from "@/lib/reports/parameters";

export const metadata = { title: "Saldo Pembukaan (Opsional)" };

export default async function OpeningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const db = getPrisma(), scope = await withFiscalYear(await searchParams, false);
  const marker = await db.openingJournal.findUnique({
    where: { singletonKey: 1 },
    include: {
      journalEntry: { include: { reversal: true, lines: { orderBy: { lineNo: "asc" }, include: { account: true } } } },
      fiscalYear: true, createdBy: { select: { email: true } },
    },
  });
  const year = scope.years.find(year => String(year.year) === scope.year);
  const editable = marker?.perAccount && marker.journalEntry.status === "POSTED" && marker.fiscalYear.status === "OPEN";
  const accounts = !marker || editable ? await openingChoices(db) : [];

  if (marker && editable) {
    for (const { account } of marker.journalEntry.lines) {
      if (!accounts.some(choice => choice.id === account.id)) accounts.push({
        id: account.id, code: account.code, name: account.name + " (pilih akun aktif untuk menyimpan)",
        mainType: account.mainType, reportGroup: account.reportGroup, normalBalance: account.normalBalance,
        isContra: account.isContra, isControlAccount: account.isControlAccount,
      });
    }
  }

  return <div className="space-y-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Saldo Pembukaan <span className="text-base text-muted-foreground">(Opsional)</span></h1>
      <p className="text-sm">Isi saldo awal beberapa COA sekaligus, misalnya BCA dan BRI. Setiap akun memiliki nominal sendiri tanpa akun lawan.</p>
    </header>
    {marker ? <>
      <section className="space-y-3 rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="text-xl font-semibold">{marker.journalEntry.lines.length} COA memiliki saldo pembukaan</h2>
        <p className="text-sm">Per {displayDate(marker.cutoverDate)} · Tahun Buku {marker.fiscalYear.year} · {marker.journalEntry.status === "REVERSED" ? "Dibatalkan dengan pembalik" : "Terposting"}</p>
        {editable ? <p className="text-sm">Tambahkan COA lainnya melalui formulir di bawah. Contoh: saldo BCA yang sudah tercatat tetap tersimpan saat Anda menambahkan saldo BRI.</p>
          : <div className="space-y-2">{marker.journalEntry.lines.map(line => <div key={line.id} className="flex flex-wrap justify-between gap-2 rounded-lg border p-3 text-sm">
            <span>{line.account.code} · {line.account.name}</span>
            <strong className="tabular-nums">{formatRupiah(line.debit.toFixed(0) !== "0" ? line.debit.toFixed(0) : line.credit.toFixed(0))}</strong>
          </div>)}</div>}
        {marker.fiscalYear.status === "LOCKED" && <p className="text-sm text-muted-foreground">Tahun buku pembukaan terkunci. Penambahan COA atau koreksi saldo tersedia setelah tahun tersebut dibuka kembali melalui Tahun Buku.</p>}
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Rujukan saldo pembukaan</summary>
          <div className="mt-2 space-y-2"><p>Disetujui {displayTime(marker.confirmedAt)} oleh {marker.createdBy.email}.</p><p>{marker.verificationNote}</p></div>
        </details>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline"><Link href={"/jurnal/" + marker.journalEntryId}>Lihat rincian saldo pembukaan</Link></Button>
          {!marker.perAccount && marker.journalEntry.status === "POSTED" && marker.fiscalYear.status === "OPEN" && <Button asChild><Link href={"/jurnal/" + marker.journalEntryId + "/ubah"}>Ubah saldo pembukaan</Link></Button>}
        </div>
        {marker.journalEntry.reversal && <Link className="text-sm text-primary underline" href={"/jurnal/" + marker.journalEntry.reversal.id}>Lihat jurnal pembalik {marker.journalEntry.reversal.journalNumber}</Link>}
      </section>
      {editable && <JournalForm key={marker.journalEntryId + ":" + marker.journalEntry.version}
        accounts={accounts} today={dateString(marker.cutoverDate)} fixedDate perAccountOpening returnHref="/saldo-pembukaan"
        initial={{
          id: marker.journalEntryId, version: marker.journalEntry.version, journalNumber: marker.journalEntry.journalNumber,
          date: dateString(marker.cutoverDate), description: marker.journalEntry.description,
          lines: marker.journalEntry.lines.map(line => ({ accountId: line.accountId, debit: line.debit.toFixed(0), credit: line.credit.toFixed(0), description: line.description ?? "" })),
        }} />}
    </> : year ? <OpeningForm key={year.id} accounts={accounts} year={year} />
      : <p className="rounded-xl border p-6">Belum ada Tahun Buku. <Link className="text-primary underline" href="/tahun-buku">Tambahkan tahun terbuka</Link> bila ingin memakai saldo pembukaan; tidak ada saldo dibuat otomatis.</p>}
  </div>;
}
