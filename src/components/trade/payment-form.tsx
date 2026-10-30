"use client";

import Link from "@/components/year-link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { paymentFields, type TradeKind } from "@/lib/trade/validation";
import { displayDate } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";
import { MoneyInput } from "@/components/loans/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tradeLabels } from "./labels";
import { useTradeSubmission } from "./use-trade-submission";

type PaymentInput = z.input<typeof paymentFields>;
type PaymentValues = z.output<typeof paymentFields>;
type DocumentSummary = { id: string; partyName: string; documentNumber: string; remaining: string };

export function TradePaymentForm({ kind, accounts, today, minimumDate, document }: { kind: TradeKind; accounts: { id: string; name: string }[]; today: string; minimumDate: string; document: DocumentSummary }) {
  const labels = tradeLabels(kind);
  const [review, setReview] = useState<PaymentValues | null>(null);
  const { submit, pending, message, saved, clearMessage } = useTradeSubmission(kind, "CREATE_PAYMENT");
  const { register, control, handleSubmit, setError, formState: { errors } } = useForm<PaymentInput, unknown, PaymentValues>({
    resolver: zodResolver(paymentFields),
    defaultValues: { date: today, amount: "", cashAccountId: "", notes: "" },
  });
  const error = (name: keyof PaymentInput) => errors[name]?.message ? <p id={`${name}-error`} role="alert" className="text-sm text-destructive">{errors[name]?.message}</p> : null;

  function preview(values: PaymentValues) {
    if (BigInt(values.amount) > BigInt(document.remaining)) {
      setError("amount", { message: "Jumlah melebihi sisa tagihan yang ditampilkan. Muat ulang bila sisa berubah." });
      return;
    }
    if (values.date < minimumDate) {
      setError("date", { message: "Tanggal pembayaran tidak boleh mendahului tagihan." });
      return;
    }
    clearMessage();
    setReview(values);
  }

  if (saved) return (
    <section className="max-w-2xl space-y-5 rounded-xl border bg-card p-6">
      <h2 role="status" className="text-lg font-semibold">{message}</h2>
      <p className="break-all font-mono text-sm">{saved.number}</p>
      <p className="text-sm text-muted-foreground">Pembayaran dan jurnal otomatis sudah dicatat bersama.</p>
      <div className="flex flex-wrap gap-3"><Button asChild><Link href={`${labels.path}/${document.id}`}>Lihat sisa & riwayat pembayaran</Link></Button><Button asChild variant="outline"><Link href={`/jurnal/${saved.journalId}`}>Lihat Jurnal Otomatis</Link></Button></div>
    </section>
  );

  if (review) return (
    <section className="max-w-2xl space-y-5 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Periksa pembayaran</h2>
      <p>{kind === "RECEIVABLE" ? "Terima pembayaran dari" : "Bayar tagihan kepada"} <strong>{document.partyName}</strong> sebesar <strong>{formatRupiah(review.amount)}</strong>.</p>
      <p className="break-all font-mono text-sm">{document.documentNumber}</p>
      <p className="text-sm">{labels.cashField}: <strong>{accounts.find(account => account.id === review.cashAccountId)?.name}</strong>. Tanggal: {displayDate(review.date)}.</p>
      <p className="text-sm">Perkiraan sisa tagihan: <strong>{formatRupiah(BigInt(document.remaining) - BigInt(review.amount))}</strong>. Sisa diperiksa kembali saat Simpan.</p>
      {review.notes && <p className="whitespace-pre-wrap text-sm">Catatan: {review.notes}</p>}
      <p className="text-sm text-muted-foreground">Setelah dicatat, koreksi dilakukan melalui pembatalan dengan jurnal pembalik.</p>
      {message && <p role="alert" className="rounded-lg border p-3 text-sm">{message}</p>}
      <div className="flex flex-wrap gap-3"><Button loading={pending} type="button" disabled={pending} onClick={() => submit({ ...review, documentId: document.id })}>{pending ? "Menyimpan…" : "Simpan & Catat"}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => { setReview(null); clearMessage(); }}>Ubah isian</Button></div>
    </section>
  );

  return (
    <form noValidate onSubmit={event => { void handleSubmit(preview)(event); }} className="max-w-2xl space-y-5 rounded-xl border bg-card p-5 sm:p-7">
      <div className="space-y-2 rounded-lg bg-muted p-4"><p className="font-semibold">{document.partyName}</p><p className="break-all font-mono text-sm">{document.documentNumber}</p><p className="text-sm">Sisa tagihan <strong>{formatRupiah(document.remaining)}</strong></p></div>
      <div className="space-y-2"><Label htmlFor="date">Tanggal pembayaran</Label><Input id="date" type="date" min={minimumDate} aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? "date-error" : undefined} {...register("date")} />{error("date")}</div>
      <div className="space-y-2"><Label htmlFor="amount">Jumlah pembayaran</Label><Controller name="amount" control={control} render={({ field }) => <MoneyInput id="amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(errors.amount)} />} />{error("amount")}<p className="text-sm text-muted-foreground">Dalam Rupiah. Bisa dibayar sebagian, paling banyak sebesar sisa tagihan.</p></div>
      <div className="space-y-2"><Label htmlFor="cashAccountId">{labels.cashField}</Label><select id="cashAccountId" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-invalid={Boolean(errors.cashAccountId)} aria-describedby={errors.cashAccountId ? "cashAccountId-error" : undefined} {...register("cashAccountId")}><option value="">Pilih Kas/Bank</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>{error("cashAccountId")}</div>
      <div className="space-y-2"><Label htmlFor="notes">Catatan / bukti pembayaran (opsional)</Label><textarea id="notes" rows={3} maxLength={1000} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-invalid={Boolean(errors.notes)} {...register("notes")} />{error("notes")}<p className="text-sm text-muted-foreground">Tuliskan keterangan atau referensi bukti pembayaran jika ada.</p></div>
      {!accounts.length && <p role="alert" className="text-sm text-destructive">Belum ada Kas/Bank aktif yang tersedia. Periksa Daftar Akun terlebih dahulu.</p>}
      <p className="text-sm text-muted-foreground">Nomor pembayaran dibuat otomatis saat disimpan.</p>
      <div className="flex flex-wrap gap-3"><Button type="submit" disabled={!accounts.length}>Periksa & lanjutkan</Button><Button variant="outline" asChild><Link href={`${labels.path}/${document.id}`}>Batal</Link></Button></div>
    </form>
  );
}
