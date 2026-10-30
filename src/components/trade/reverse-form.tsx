"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { reverseTradeSchema, type TradeKind } from "@/lib/trade/validation";
import { displayDate } from "@/lib/accounting/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTradeSubmission } from "./use-trade-submission";

const reversalFields = reverseTradeSchema.omit({ requestKey: true });
type ReversalInput = z.input<typeof reversalFields>;
type ReversalValues = z.output<typeof reversalFields>;

export function ReverseTradeForm({ kind, id, payment = false, today, minimumDate }: { kind: TradeKind; id: string; payment?: boolean; today: string; minimumDate: string }) {
  const router = useRouter();
  const [review, setReview] = useState<ReversalValues | null>(null);
  const { submit, pending, message, saved, clearMessage } = useTradeSubmission(kind, payment ? "REVERSE_PAYMENT" : "REVERSE_DOCUMENT", () => router.refresh());
  const { register, handleSubmit, setError, formState: { errors } } = useForm<ReversalInput, unknown, ReversalValues>({
    resolver: zodResolver(reversalFields),
    defaultValues: { id, date: today, reason: "" },
  });
  const title = payment ? "pembayaran" : "tagihan";

  if (saved) return <p role="status" className="rounded-lg border bg-muted p-4 text-sm">{message}</p>;

  return (
    <details className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-semibold text-destructive">Batalkan {title}</summary>
      {review ? (
        <section className="mt-4 max-w-lg space-y-4">
          <h3 className="font-semibold">Pastikan pembatalan sudah benar</h3>
          <p className="text-sm">{payment ? "Pembayaran" : "Tagihan"} ini akan dibatalkan pada <strong>{displayDate(review.date)}</strong>. Histori tetap tersimpan dan jurnal pembalik dibuat otomatis.</p>
          <p className="whitespace-pre-wrap text-sm">Alasan: {review.reason}</p>
          <p className="text-sm text-muted-foreground">{payment ? "Sisa tagihan akan bertambah kembali sebesar pembayaran yang dibatalkan." : "Tagihan tidak lagi memiliki sisa yang perlu dibayar."}</p>
          {message && <p role="alert" className="rounded-lg border p-3 text-sm">{message}</p>}
          <div className="flex flex-wrap gap-3"><Button loading={pending} type="button" variant="destructive" disabled={pending} onClick={() => submit(review)}>{pending ? "Menyimpan…" : `Ya, batalkan ${title}`}</Button><Button type="button" variant="outline" disabled={pending} onClick={() => { setReview(null); clearMessage(); }}>Ubah isian</Button></div>
        </section>
      ) : (
        <form noValidate className="mt-4 max-w-lg space-y-4" onSubmit={event => { void handleSubmit(values => {
          if (values.date < minimumDate) { setError("date", { message: "Tanggal pembatalan tidak boleh mendahului transaksi asal." }); return; }
          clearMessage(); setReview(values);
        })(event); }}>
          <p className="text-sm text-muted-foreground">Pembatalan mempertahankan histori. {payment ? "Sisa tagihan akan dipulihkan." : "Semua pembayaran aktif harus dibatalkan dahulu. Tanggal pembatalan tidak boleh mendahului pembayaran atau pembatalan sebelumnya."}</p>
          <div className="space-y-2"><Label htmlFor={`reverse-date-${id}`}>Tanggal pembatalan</Label><Input id={`reverse-date-${id}`} type="date" min={minimumDate} aria-invalid={Boolean(errors.date)} {...register("date")} />{errors.date && <p role="alert" className="text-sm text-destructive">{errors.date.message}</p>}</div>
          <div className="space-y-2"><Label htmlFor={`reverse-reason-${id}`}>Alasan pembatalan</Label><textarea id={`reverse-reason-${id}`} rows={3} maxLength={1000} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-invalid={Boolean(errors.reason)} {...register("reason")} />{errors.reason && <p role="alert" className="text-sm text-destructive">{errors.reason.message}</p>}</div>
          <Button type="submit" variant="outline">Periksa pembatalan</Button>
        </form>
      )}
    </details>
  );
}
