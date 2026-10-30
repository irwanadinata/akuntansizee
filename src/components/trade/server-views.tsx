import { FilterSubmitButton } from "@/components/loading/filter-content";
import "server-only";

import Link from "@/components/year-link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Plus, ReceiptText } from "lucide-react";
import { fiscalDate } from "@/lib/fiscal/selection";
import { withFiscalYear } from "@/lib/fiscal/context";
import { getPrisma } from "@/lib/db";
import type { TradeKind } from "@/lib/trade/validation";
import { cashChoices, counterChoices, tradeDetail, tradeFilters, tradeList } from "@/lib/trade/queries";
import { tradeReconciliation } from "@/lib/trade/balances";
import { dateString, displayDate, jakartaDate } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterBar, filterSelectClass } from "@/components/filter-bar";
import { CreationLink } from "@/components/transactions/creation-link";
import { cn } from "@/lib/utils";
import { TradeDocumentForm } from "./document-form";
import { TradePaymentForm } from "./payment-form";
import { ReverseTradeForm } from "./reverse-form";
import { tradeLabels, tradeStatus } from "./labels";

export type TradeSearchParams = Record<string, string | string[] | undefined>;

function StatusBadge({ status }: { status: string }) {
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-sm font-medium", status === "Lunas" ? "border-teal-200 bg-teal-50 text-teal-800" : status === "Sebagian" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-border bg-muted text-muted-foreground")}>{status}</span>;
}

export async function TradeListView({ kind, searchParams }: { kind: TradeKind; searchParams: TradeSearchParams }) {
  const labels = tradeLabels(kind);
  const scope=await withFiscalYear(searchParams);
  const filters = tradeFilters.parse({...searchParams,year:scope.year});
  const db = getPrisma();
  const [result, years, reconciliation] = await Promise.all([
    tradeList(db, kind, filters),
    db.fiscalYear.findMany({ orderBy: { year: "desc" }, select: { year: true } }),
    tradeReconciliation(db, kind),
  ]);
  const pageLink = (page: number) => `${labels.path}?${new URLSearchParams({ q: filters.q, year: filters.year || "all", status: filters.status, page: String(page) })}`;
  const hasFilters = Boolean(filters.q || filters.year || filters.status !== "all");

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-semibold">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{kind === "RECEIVABLE" ? "Catat tagihan customer dan uang yang sudah diterima. Sisa tagihan dihitung otomatis." : "Catat tagihan supplier dan pembayaran yang sudah dilakukan. Pilih biaya atau aset sesuai tagihan."}</p></div>
        <Button asChild><CreationLink kind={kind === "RECEIVABLE" ? "receivable" : "payable"}><Plus aria-hidden="true" />{labels.create}</CreationLink></Button>
      </header>

      <section className="rounded-xl border bg-card p-5" aria-labelledby="outstanding-heading">
        <h2 id="outstanding-heading" className="text-sm text-muted-foreground">Sisa seluruh tagihan {labels.party.toLowerCase()}</h2>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{formatRupiah(reconciliation.detail)}</p>
        <p className="mt-2 text-sm text-muted-foreground">{reconciliation.difference === "0" ? `Rincian sesuai dengan saldo ${labels.control} di buku besar.` : "Rincian berbeda dengan buku besar dan perlu diperiksa."}</p>
        {reconciliation.difference !== "0" && <div role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p className="font-semibold">Perlu pemeriksaan saldo</p><p className="mt-1">Buku besar: {formatRupiah(reconciliation.control)} · Selisih rincian: {formatRupiah(reconciliation.difference)}</p><p className="mt-1">Periksa jurnal dan rinciannya sebelum menggunakan laporan.</p></div>}
      </section>

      <FilterBar action={labels.path} actions={<><Button asChild variant="outline"><Link href={labels.path}>Reset</Link></Button><FilterSubmitButton>Terapkan</FilterSubmitButton></>}>
        <div className="space-y-2"><Label htmlFor="q">Cari nama atau nomor</Label><Input id="q" name="q" defaultValue={filters.q} maxLength={100} placeholder={kind === "RECEIVABLE" ? "Nama, nomor PIU/BYC, faktur luar" : "Nama, nomor UTG/BYS, referensi luar"} /></div>
        <div className="space-y-2"><Label htmlFor="year">Tahun tagihan</Label><select id="year" name="year" className={filterSelectClass} defaultValue={filters.year || "all"}><option value="all">Semua tahun</option>{years.map(year => <option key={year.year} value={String(year.year)}>{year.year}</option>)}</select></div>
        <div className="space-y-2"><Label htmlFor="status">Status</Label><select id="status" name="status" className={filterSelectClass} defaultValue={filters.status}><option value="all">Semua status</option><option value="unpaid">Belum Lunas</option><option value="partial">Sebagian</option><option value="paid">Lunas</option><option value="cancelled">Dibatalkan</option></select></div>
      </FilterBar>

      <section className="overflow-hidden rounded-xl border bg-card" aria-label={`Daftar tagihan ${labels.party.toLowerCase()}`}>
        {result.rows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-left text-sm"><caption className="sr-only">Daftar tagihan {labels.party.toLowerCase()}, pembayaran, dan sisa tagihan</caption><thead className="bg-muted"><tr><th scope="col" className="p-4">Tanggal</th><th scope="col" className="p-4">{labels.party} / nomor tagihan</th><th scope="col" className="p-4 text-right">Tagihan awal</th><th scope="col" className="p-4 text-right">{labels.received}</th><th scope="col" className="p-4 text-right">Sisa tagihan</th><th scope="col" className="p-4">Status</th></tr></thead><tbody>{result.rows.map(document => <tr key={document.id} className="border-t"><td className="p-4 align-top whitespace-nowrap">{displayDate(document.date)}</td><td className="p-4"><Link href={`${labels.path}/${document.id}`} className="font-semibold text-primary underline underline-offset-4">{document.partyName}</Link><p className="mt-2 break-all font-mono text-sm">{document.documentNumber}</p>{document.externalReference && <p className="mt-1 break-all text-sm text-muted-foreground">Referensi luar: {document.externalReference}</p>}</td><td className="p-4 text-right align-top whitespace-nowrap tabular-nums">{formatRupiah(document.amount)}</td><td className="p-4 text-right align-top whitespace-nowrap tabular-nums">{formatRupiah(document.paid)}</td><td className="p-4 text-right align-top font-semibold whitespace-nowrap tabular-nums">{formatRupiah(document.remaining)}</td><td className="p-4 align-top"><StatusBadge status={tradeStatus(document.reversalEntryId, document.remaining, document.paid)} /></td></tr>)}</tbody></table></div> : <EmptyState icon={ReceiptText} title={hasFilters ? "Belum ada tagihan yang sesuai" : `Belum ada tagihan ${labels.party.toLowerCase()}`} description={hasFilters ? "Ubah pencarian, tahun, atau status untuk melihat tagihan lainnya." : `Catat tagihan pertama untuk mulai memantau pembayaran dan sisa tagihan ${labels.party.toLowerCase()}.`}><Button asChild variant="outline">{hasFilters ? <Link href={labels.path}>Reset pencarian</Link> : <CreationLink kind={kind === "RECEIVABLE" ? "receivable" : "payable"}>{labels.create}</CreationLink>}</Button></EmptyState>}
        <nav aria-label={`Halaman tagihan ${labels.party.toLowerCase()}`} className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-sm"><p>{result.total} tagihan · Halaman {result.page} dari {result.pages}</p><div className="flex gap-5">{result.page > 1 && <Link className="text-primary underline underline-offset-4" href={pageLink(result.page - 1)}>Sebelumnya</Link>}{result.page < result.pages && <Link className="text-primary underline underline-offset-4" href={pageLink(result.page + 1)}>Berikutnya</Link>}</div></nav>
      </section>
      <p className="text-sm leading-6 text-muted-foreground">Sisa seluruh tagihan mencakup semua tahun. Filter tahun menyaring tanggal tagihan pada daftar; pembayaran dan pembatalan yang sudah dicatat tetap diperhitungkan.</p>
    </div>
  );
}

export async function NewTradeDocumentView({ kind,searchParams={} }: { kind: TradeKind;searchParams?:TradeSearchParams }) {
  const labels = tradeLabels(kind);
  const scope=await withFiscalYear(searchParams);
  const accounts = await counterChoices(getPrisma(), kind);
  return <div className="space-y-6"><header><Link href={labels.path} className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4"><ArrowLeft className="size-4" aria-hidden="true" />Kembali ke {labels.title}</Link><h1 className="mt-4 text-2xl font-semibold">{labels.create}</h1><p className="mt-2 text-sm text-muted-foreground">Isi nama {labels.party.toLowerCase()}, tanggal, jumlah, dan {kind === "RECEIVABLE" ? "sumber pendapatan" : "kategori pengeluaran"}. Jurnal dicatat otomatis.</p></header><TradeDocumentForm kind={kind} accounts={accounts} today={fiscalDate(scope.year,jakartaDate())} /></div>;
}

export async function TradeDetailView({ kind, id, searchParams }: { kind: TradeKind; id: string; searchParams: TradeSearchParams }) {
  if (!z.uuid().safeParse(id).success) notFound();
  const page = z.coerce.number().int().min(1).max(100000).catch(1).parse(searchParams.page);
  const result = await tradeDetail(getPrisma(), kind, id, page);
  if (!result) notFound();
  const { document, payments, balance } = result;
  const labels = tradeLabels(kind);
  const status = tradeStatus(document.reversalEntryId, balance.remaining, balance.paid);
  const scope=await withFiscalYear(searchParams);
  const today = fiscalDate(scope.year,jakartaDate());
  const documentDate = dateString(document.date);
  const canPay = !document.reversalEntryId && BigInt(balance.remaining) > 0n;
  const hasActivePayments = BigInt(balance.paid) > 0n;
  const knownDates = [today, documentDate, ...payments.flatMap(payment => [dateString(payment.date), ...(payment.reversalEntry ? [dateString(payment.reversalEntry.date)] : [])])];
  const defaultReverseDate = knownDates.sort().at(-1)!;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3"><Link href={labels.path} className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4"><ArrowLeft className="size-4" aria-hidden="true" />Kembali ke {labels.title}</Link><h1 className="text-2xl font-semibold">{document.partyName}</h1><p className="break-all font-mono text-sm">{document.documentNumber}</p><div className="flex flex-wrap items-center gap-3"><span className="text-sm">{displayDate(document.date)}</span><StatusBadge status={status} /></div></div>
        {canPay && <Button asChild><Link href={`${labels.path}/${id}/pembayaran/baru`}><Plus aria-hidden="true" />{labels.payment}</Link></Button>}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">{[["Tagihan awal", document.amount.toFixed(0)], [labels.received, balance.paid], ["Sisa tagihan", balance.remaining]].map(([label, amount]) => <section key={label} className="rounded-xl border bg-card p-5"><h2 className="text-sm text-muted-foreground">{label}</h2><p className="mt-2 text-xl font-semibold tabular-nums">{formatRupiah(amount)}</p></section>)}</div>

      <section aria-labelledby="document-detail-heading" className="space-y-4 rounded-xl border bg-card p-5">
        <h2 id="document-detail-heading" className="text-base font-semibold">Rincian tagihan</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">{labels.counterField}</dt><dd className="mt-1 font-medium">{document.counterAccount.name}</dd></div><div><dt className="text-muted-foreground">Jatuh tempo</dt><dd className="mt-1">{document.dueDate ? displayDate(document.dueDate) : "Tidak ditentukan"}</dd></div>{document.externalReference && <div className="sm:col-span-2"><dt className="text-muted-foreground">{labels.externalField.replace(" (opsional)", "")}</dt><dd className="mt-1 break-all">{document.externalReference}</dd></div>}{document.notes && <div className="sm:col-span-2"><dt className="text-muted-foreground">Catatan</dt><dd className="mt-1 whitespace-pre-wrap">{document.notes}</dd></div>}</dl>
        <Link href={`/jurnal/${document.journalEntryId}`} className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4">Lihat Jurnal Otomatis · {document.journalEntry.journalNumber}<ArrowRight className="size-4" aria-hidden="true" /></Link>
        {document.reversalEntry && <div className="space-y-2 rounded-lg bg-muted p-4 text-sm"><p>Tagihan dibatalkan {displayDate(document.reversalEntry.date)}.</p><p className="whitespace-pre-wrap">Alasan: {document.reversalReason}</p><Link href={`/jurnal/${document.reversalEntry.id}`} className="inline-block text-primary underline underline-offset-4">Lihat jurnal pembalik · {document.reversalEntry.journalNumber}</Link></div>}
      </section>

      <section aria-labelledby="payment-history-heading" className="space-y-4">
        <h2 id="payment-history-heading" className="text-lg font-semibold">Riwayat pembayaran</h2>
        {!payments.length && <div className="rounded-xl border bg-card"><EmptyState icon={ReceiptText} title="Belum ada pembayaran" description={document.reversalEntryId ? "Tagihan ini sudah dibatalkan dan historinya tetap tersimpan." : "Pembayaran dapat dicatat sebagian atau penuh. Sisa tagihan akan diperbarui otomatis."} /></div>}
        {payments.map(payment => {
          const paymentDate = dateString(payment.date);
          return <article key={payment.id} className="space-y-4 rounded-xl border bg-card p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-semibold tabular-nums">{formatRupiah(payment.amount.toFixed(0))}</h3><p className="mt-1 text-sm">{displayDate(payment.date)} · {payment.reversalEntryId ? "Dibatalkan" : kind === "RECEIVABLE" ? "Pembayaran diterima" : "Sudah dibayar"}</p><p className="mt-2 text-sm">{labels.cashField}: <strong>{payment.cashAccount.name}</strong></p><p className="mt-2 break-all font-mono text-sm">{payment.paymentNumber}</p></div><Link href={`/jurnal/${payment.journalEntryId}`} className="text-sm text-primary underline underline-offset-4">Lihat Jurnal Otomatis</Link></div>{payment.notes && <p className="whitespace-pre-wrap text-sm">Catatan: {payment.notes}</p>}{payment.reversalEntry ? <div className="space-y-2 rounded-lg bg-muted p-4 text-sm"><p>Dibatalkan {displayDate(payment.reversalEntry.date)}: {payment.reversalReason}</p><Link href={`/jurnal/${payment.reversalEntry.id}`} className="inline-block text-primary underline underline-offset-4">Lihat jurnal pembalik · {payment.reversalEntry.journalNumber}</Link></div> : !document.reversalEntryId && <ReverseTradeForm kind={kind} id={payment.id} payment today={today < paymentDate ? paymentDate : today} minimumDate={paymentDate} />}</article>;
        })}
        <nav aria-label="Halaman riwayat pembayaran" className="flex flex-wrap justify-between gap-3 text-sm"><p>{result.total} pembayaran · Halaman {result.page} dari {result.pages}</p><div className="flex gap-5">{result.page > 1 && <Link href={`?page=${result.page - 1}`} className="text-primary underline underline-offset-4">Sebelumnya</Link>}{result.page < result.pages && <Link href={`?page=${result.page + 1}`} className="text-primary underline underline-offset-4">Berikutnya</Link>}</div></nav>
      </section>

      {!document.reversalEntryId && <section aria-labelledby="document-cancellation-heading" className="space-y-3"><h2 id="document-cancellation-heading" className="text-base font-semibold">Koreksi tagihan</h2>{hasActivePayments ? <p className="rounded-lg border bg-muted p-4 text-sm text-muted-foreground">Tagihan masih memiliki pembayaran aktif. Batalkan semua pembayaran tersebut terlebih dahulu sebelum membatalkan tagihan.</p> : <ReverseTradeForm kind={kind} id={id} today={defaultReverseDate} minimumDate={documentDate} />}</section>}
      <p className="text-sm text-muted-foreground">Transaksi yang sudah dicatat tidak dapat diubah atau dihapus. Pembatalan mempertahankan transaksi asal dan membuat jurnal pembalik.</p>
    </div>
  );
}

export async function NewTradePaymentView({ kind, id,searchParams={} }: { kind: TradeKind; id: string;searchParams?:TradeSearchParams }) {
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getPrisma();
  const result = await tradeDetail(db, kind, id);
  if (!result) notFound();
  const { document, balance } = result;
  const labels = tradeLabels(kind);
  if (document.reversalEntryId || balance.remaining === "0") return <div className="space-y-5"><h1 className="text-2xl font-semibold">Tagihan sudah {document.reversalEntryId ? "dibatalkan" : "lunas"}</h1><p className="text-sm text-muted-foreground">Pembayaran baru tidak dapat dicatat untuk tagihan ini.</p><Button variant="outline" asChild><Link href={`${labels.path}/${id}`}>Kembali ke rincian tagihan</Link></Button></div>;
  const minimumDate = dateString(document.date);
  const scope=await withFiscalYear(searchParams),date=fiscalDate(scope.year,jakartaDate());
  const today = date < minimumDate ? minimumDate : date;
  return <div className="space-y-6"><header><Link href={`${labels.path}/${id}`} className="inline-flex items-center gap-2 text-sm text-primary underline underline-offset-4"><ArrowLeft className="size-4" aria-hidden="true" />Kembali ke rincian tagihan</Link><h1 className="mt-4 text-2xl font-semibold">{labels.paymentTitle}</h1><p className="mt-2 text-sm text-muted-foreground">Catat pembayaran sebagian atau penuh. Jurnal dibuat otomatis.</p></header><TradePaymentForm kind={kind} accounts={await cashChoices(db)} today={today} minimumDate={minimumDate} document={{ id, partyName: document.partyName, documentNumber: document.documentNumber, remaining: balance.remaining }} /></div>;
}
