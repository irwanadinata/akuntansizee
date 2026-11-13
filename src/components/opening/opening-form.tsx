"use client";

import { useRef, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "@/components/year-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/loans/money-input";
import { AccountSelect } from "@/components/coa/account-select";
import { accountOpeningFields } from "@/lib/opening/validation";
import type { OpeningAccount } from "@/lib/opening/simple";
import type { OpeningPreview, OpeningResult } from "@/lib/opening/engine";
import { formatRupiah } from "@/lib/accounting/money";
import { displayDate } from "@/lib/accounting/dates";
import { postOpeningAction, previewOpeningAction } from "@/app/(admin)/saldo-pembukaan/actions";

type Values = z.input<typeof accountOpeningFields>;

export function OpeningForm({ accounts, year }: {
  accounts: OpeningAccount[];
  year: { id: string; year: number; status: "OPEN" | "LOCKED" };
}) {
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<OpeningResult | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef({ fingerprint: "", key: "" });
  const busy = useRef(false);
  const { control, register, handleSubmit, formState: { errors } } = useForm<Values, unknown, z.output<typeof accountOpeningFields>>({
    resolver: zodResolver(accountOpeningFields),
    defaultValues: {
      perAccount: true, fiscalYearId: year.id, cutoverDate: `${year.year}-01-01`, journalNumber: "", verificationNote: "",
      lines: [{ accountId: "", amount: "" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });

  function inspect(values: unknown) {
    startTransition(async () => {
      setMessage("");
      try {
        const result = await previewOpeningAction(values);
        setMessage(result.message);
        if (result.ok && result.preview) { setPreview(result.preview); setConfirmed(false); }
      } catch { setMessage("Saldo pembukaan belum dapat diperiksa. Belum ada saldo disimpan."); }
    });
  }

  function save() {
    if (!preview || !confirmed || busy.current || saved) return;
    const payload = { ...preview.input, previewHash: preview.previewHash, confirmed: true };
    const fingerprint = JSON.stringify(payload);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await postOpeningAction({ ...payload, requestKey: request.current.key });
        setMessage(result.message);
        if (result.ok && result.result) setSaved(result.result);
      } catch { setMessage("Koneksi terputus. Ulangi Simpan dengan isi sama agar saldo tidak tercatat dua kali."); }
      finally { busy.current = false; }
    });
  }

  if (saved) return <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
    <h2 role="status" className="text-xl font-semibold">Saldo pembukaan tersimpan</h2>
    <p className="text-sm">Saldo setiap COA sudah tercatat tanpa akun lawan.</p>
    <Button asChild><Link href={"/jurnal/" + saved.id}>Lihat rincian saldo pembukaan</Link></Button>
  </section>;

  if (preview) return <section className="space-y-5 rounded-xl border bg-card p-5">
    <h2 className="text-xl font-semibold">Periksa saldo pembukaan</h2>
    <p className="text-sm">Per {displayDate(preview.input.cutoverDate)} · Tahun Buku {preview.year}</p>
    <div className="space-y-3">{preview.lines.map(line => <div key={line.accountId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4">
      <span className="min-w-0 break-words text-sm">{line.code} · {line.name}</span>
      <strong className="tabular-nums">{formatRupiah(line.amount)}</strong>
    </div>)}</div>
    <p className="text-sm text-muted-foreground">Saldo dicatat langsung pada masing-masing COA sesuai saldo normalnya. Tidak ada akun lawan atau modal otomatis.</p>
    <p className="text-sm text-muted-foreground">Catatan: {preview.input.verificationNote}</p>
    <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
      <input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />
      <span>COA, saldo dan tanggal sudah benar, serta saldo ini belum pernah dicatat di aplikasi.</span>
    </label>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button loading={pending} disabled={pending || !confirmed} onClick={save}>{pending ? "Menyimpan…" : "Simpan saldo pembukaan"}</Button>
      <Button variant="outline" disabled={pending} onClick={() => { setPreview(null); setConfirmed(false); setMessage(""); }}>Ubah isian</Button>
    </div>
  </section>;

  return <form className="space-y-5 rounded-xl border bg-card p-5" noValidate onSubmit={event => { void handleSubmit(inspect)(event); }}>
    <p className="text-sm text-muted-foreground">Tahun Buku {year.year} · {year.status === "OPEN" ? "Terbuka" : "Terkunci"}</p>
    <fieldset disabled={pending} className="min-w-0 space-y-5">
      <div className="max-w-sm space-y-2">
        <Label htmlFor="opening-date">Tanggal saldo pembukaan</Label>
        <Input id="opening-date" type="date" min={`${year.year}-01-01`} max={`${year.year}-12-31`} {...register("cutoverDate")} />
        <p role="alert" className="text-sm text-destructive">{errors.cutoverDate?.message}</p>
      </div>
      <p className="text-sm text-muted-foreground">Pilih COA dan isi saldo awalnya. Contoh: BRI Rp10.000.000 dan BCA Rp20.000.000. Tambahkan semua COA yang memiliki saldo pembukaan sebelum menyimpan.</p>
      <div className="space-y-3">{fields.map((field, index) => <div key={field.id} className="grid min-w-0 gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2">
          <Label htmlFor={"opening-account-" + index}>{"COA " + (index + 1)}</Label>
          <Controller control={control} name={`lines.${index}.accountId`} render={({ field }) => <AccountSelect {...field} id={"opening-account-" + index} accounts={accounts} disabled={pending} invalid={Boolean(errors.lines?.[index]?.accountId)} />} />
          <p role="alert" className="text-sm text-destructive">{errors.lines?.[index]?.accountId?.message}</p>
        </div>
        <div className="min-w-0 space-y-2">
          <Label htmlFor={"opening-amount-" + index}>{"Saldo pembukaan " + (index + 1)}</Label>
          <Controller control={control} name={`lines.${index}.amount`} render={({ field }) => <MoneyInput id={"opening-amount-" + index} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(errors.lines?.[index]?.amount)} />} />
          <p role="alert" className="text-sm text-destructive">{errors.lines?.[index]?.amount?.message}</p>
        </div>
        <Button type="button" variant="ghost" className="sm:mt-6" disabled={fields.length <= 1 || pending} onClick={() => remove(index)} aria-label={"Hapus COA " + (index + 1)}>Hapus</Button>
      </div>)}</div>
      <p role="alert" className="text-sm text-destructive">{errors.lines?.root?.message ?? errors.lines?.message}</p>
      <Button type="button" variant="outline" disabled={fields.length >= 100 || pending} onClick={() => append({ accountId: "", amount: "" })}>Tambah COA</Button>
      <div className="space-y-2">
        <Label htmlFor="opening-note">Catatan / bukti saldo (opsional)</Label>
        <Input id="opening-note" {...register("verificationNote")} maxLength={1000} placeholder="Contoh: saldo sesuai rekening koran per 1 Januari" />
        <p role="alert" className="text-sm text-destructive">{errors.verificationNote?.message}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="opening-number">Nomor jurnal (opsional)</Label>
        <Input id="opening-number" {...register("journalNumber")} maxLength={40} placeholder="Kosongkan untuk nomor otomatis" />
        <p role="alert" className="text-sm text-destructive">{errors.journalNumber?.message}</p>
      </div>
      <p className="text-sm text-muted-foreground">Tanpa akun lawan otomatis. Neraca akan menunjukkan selisih jika saldo aset, utang dan modal belum lengkap. Pembukaan disimpan satu kali; koreksi dapat dilakukan melalui rincian saldo pembukaan.</p>
      {!accounts.length && <p className="text-sm text-destructive">Belum ada COA aktif yang dapat dipilih untuk saldo pembukaan. Periksa status akun dan persetujuan untuk akun yang wajib direview.</p>}
      {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button loading={pending} type="submit" disabled={pending || !accounts.length || year.status !== "OPEN"}>{pending ? "Memeriksa…" : "Periksa saldo pembukaan"}</Button>
        <Button asChild variant="outline"><Link href="/">Lewati, mulai dari Rp0</Link></Button>
      </div>
    </fieldset>
  </form>;
}
