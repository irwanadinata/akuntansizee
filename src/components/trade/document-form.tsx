"use client";

import Link from "@/components/year-link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { documentFields, type TradeKind } from "@/lib/trade/validation";
import { formatRupiah } from "@/lib/accounting/money";
import { displayDate } from "@/lib/accounting/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/loans/money-input";
import { tradeLabels } from "./labels";
import { useTradeSubmission } from "./use-trade-submission";
import { usePanelForm } from "@/components/transactions/panel-context";
import { CreationCancel } from "@/components/transactions/creation-link";
import { cn } from "@/lib/utils";

type DocumentInput = z.input<ReturnType<typeof documentFields>>;
type DocumentValues = z.output<ReturnType<typeof documentFields>>;
type CounterChoice = { id: string; name: string; mainType: string; reportGroup: string };

export function TradeDocumentForm({ kind, accounts, today }: { kind: TradeKind; accounts: CounterChoice[]; today: string }) {
  const labels = tradeLabels(kind);
  const [review, setReview] = useState<DocumentValues | null>(null);
  const { submit, pending, message, saved, clearMessage } = useTradeSubmission(kind, "CREATE_DOCUMENT");
  const { register, control, handleSubmit, formState: { errors, isDirty } } = useForm<DocumentInput, unknown, DocumentValues>({
    resolver: zodResolver(documentFields(kind)),
    defaultValues: { partyName: "", date: today, dueDate: "", amount: "", counterAccountId: "", externalReference: "", notes: "" },
  });
  const panel = usePanelForm({ dirty: isDirty || review !== null, pending, saved: Boolean(saved) });
  const surface = panel ? "space-y-5" : "max-w-2xl space-y-5 rounded-xl border bg-card p-5 sm:p-7";
  const actions = cn("flex flex-wrap gap-3", panel && "transaction-panel-actions");

  const fieldError = (name: keyof DocumentInput) => errors[name]?.message
    ? <p id={`${name}-error`} role="alert" className="text-sm text-destructive">{errors[name]?.message}</p>
    : null;
  const groups = kind === "RECEIVABLE"
    ? [{ type: "REVENUE", title: "Pendapatan" }]
    : [{ type: "COGS", title: "Biaya Event / HPP" }, { type: "EXPENSE", title: "Biaya Operasional" }, { type: "ASSET", title: "Aset" }];

  if (saved) return (
    <section className={panel ? "space-y-5 pb-6" : "max-w-2xl space-y-5 rounded-xl border bg-card p-6"}>
      <h2 role="status" className="text-lg font-semibold">{message}</h2>
      <p className="break-all font-mono text-sm">{saved.number}</p>
      <p className="text-sm text-muted-foreground">Tagihan dan jurnal otomatis sudah dicatat. Nomor tagihan dibuat oleh sistem.</p>
      <div className="flex flex-wrap gap-3">
        {panel && <Button disabled={pending} onClick={panel.dismiss}>Selesai</Button>}
        <Button asChild variant={panel ? "outline" : "default"}><Link href={`${labels.path}/${saved.documentId}`}>Lihat tagihan & pembayaran</Link></Button>
        <Button asChild variant="outline"><Link href={`/jurnal/${saved.journalId}`}>Lihat Jurnal Otomatis</Link></Button>
      </div>
    </section>
  );

  if (review) return (
    <section className={surface}>
      <h2 className="text-lg font-semibold">Periksa sebelum mencatat</h2>
      <p>Tagihan {kind === "RECEIVABLE" ? "untuk" : "dari"} <strong>{review.partyName}</strong> sebesar <strong>{formatRupiah(review.amount)}</strong>.</p>
      <dl className="space-y-3 text-sm">
        <div><dt className="text-muted-foreground">Tanggal tagihan</dt><dd className="mt-1">{displayDate(review.date)}</dd></div>
        <div><dt className="text-muted-foreground">{labels.counterField}</dt><dd className="mt-1">{accounts.find(account => account.id === review.counterAccountId)?.name}</dd></div>
        {review.dueDate && <div><dt className="text-muted-foreground">Jatuh tempo</dt><dd className="mt-1">{displayDate(review.dueDate)}</dd></div>}
        {review.externalReference && <div><dt className="text-muted-foreground">{labels.externalField}</dt><dd className="mt-1 break-all">{review.externalReference}</dd></div>}
        {review.notes && <div><dt className="text-muted-foreground">Catatan</dt><dd className="mt-1 whitespace-pre-wrap">{review.notes}</dd></div>}
      </dl>
      <p className="text-sm text-muted-foreground">Jurnal dicatat otomatis. Setelah disimpan, koreksi dilakukan melalui pembatalan dengan jurnal pembalik.</p>
      {message && <p role="alert" className="rounded-lg border p-3 text-sm">{message}</p>}
      <div className={actions}>
        <Button loading={pending} type="button" disabled={pending} onClick={() => submit(review)}>{pending ? "Menyimpan…" : "Simpan & Catat"}</Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => { setReview(null); clearMessage(); }}>Ubah isian</Button>
      </div>
    </section>
  );

  return (
    <form noValidate onSubmit={event => { void handleSubmit(values => { clearMessage(); setReview(values); })(event); }} className={surface}>
      <div className="space-y-2">
        <Label htmlFor="partyName">{labels.partyField}</Label>
        <Input id="partyName" maxLength={200} aria-invalid={Boolean(errors.partyName)} aria-describedby={errors.partyName ? "partyName-error" : undefined} {...register("partyName")} />
        {fieldError("partyName")}
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Tanggal tagihan</Label>
        <Input id="date" type="date" aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? "date-error" : undefined} {...register("date")} />
        {fieldError("date")}
      </div>
      <div className="space-y-2">
        <Label htmlFor="amount">Jumlah tagihan</Label>
        <Controller name="amount" control={control} render={({ field }) => <MoneyInput id="amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(errors.amount)} />} />
        {fieldError("amount")}
        <p className="text-sm text-muted-foreground">Dalam Rupiah, tanpa pecahan.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="counterAccountId">{labels.counterField}</Label>
        <select id="counterAccountId" className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-invalid={Boolean(errors.counterAccountId)} aria-describedby={errors.counterAccountId ? "counterAccountId-error" : undefined} {...register("counterAccountId")}>
          <option value="">{kind === "RECEIVABLE" ? "Pilih pendapatan" : "Pilih kategori pengeluaran"}</option>
          {groups.map(group => {
            const choices = accounts.filter(account => account.mainType === group.type);
            return choices.length ? <optgroup label={group.title} key={group.type}>{choices.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</optgroup> : null;
          })}
        </select>
        {fieldError("counterAccountId")}
        {kind === "PAYABLE" && <p className="text-sm text-muted-foreground">Pilih biaya kegiatan, biaya operasional, atau aset sesuai isi tagihan.</p>}
      </div>
      <details className="rounded-lg border p-4" open={Boolean(errors.dueDate || errors.externalReference || errors.notes)}>
        <summary className="cursor-pointer text-sm font-semibold">Informasi tambahan (opsional)</summary>
        <div className="mt-5 space-y-5">
          <div className="space-y-2"><Label htmlFor="dueDate">Jatuh tempo (opsional)</Label><Input id="dueDate" type="date" aria-invalid={Boolean(errors.dueDate)} {...register("dueDate")} />{fieldError("dueDate")}</div>
          <div className="space-y-2"><Label htmlFor="externalReference">{labels.externalField}</Label><Input id="externalReference" maxLength={100} aria-invalid={Boolean(errors.externalReference)} {...register("externalReference")} />{fieldError("externalReference")}<p className="text-sm text-muted-foreground">Diisi dari dokumen luar jika ada. Nomor tagihan internal dibuat otomatis.</p></div>
          <div className="space-y-2"><Label htmlFor="notes">Catatan (opsional)</Label><textarea id="notes" rows={3} maxLength={1000} className="w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-invalid={Boolean(errors.notes)} {...register("notes")} />{fieldError("notes")}</div>
        </div>
      </details>
      {!accounts.length && <p role="alert" className="text-sm text-destructive">Belum ada akun {kind === "RECEIVABLE" ? "pendapatan" : "biaya atau aset"} aktif yang tersedia. Periksa Daftar Akun terlebih dahulu.</p>}
      <p className="text-sm text-muted-foreground">Nomor tagihan dibuat otomatis. Tidak perlu membuat akun {labels.party.toLowerCase()} atau mengisi debit/kredit. Pajak tidak dihitung otomatis.</p>
      <div className={actions}><Button type="submit" disabled={!accounts.length}>Periksa & lanjutkan</Button><CreationCancel href={labels.path} /></div>
    </form>
  );
}
