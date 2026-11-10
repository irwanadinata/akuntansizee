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
import { openingFields } from "@/lib/opening/validation";
import { isOpeningCapital, isOpeningCash, simpleOpeningFields, type OpeningAccount } from "@/lib/opening/simple";
import type { OpeningPreview, OpeningResult } from "@/lib/opening/engine";
import { formatRupiah } from "@/lib/accounting/money";
import { displayDate } from "@/lib/accounting/dates";
import { postOpeningAction, previewOpeningAction, previewSimpleOpeningAction } from "@/app/(admin)/saldo-pembukaan/actions";

type ManualValues = z.input<typeof openingFields>;
type SimpleValues = z.input<typeof simpleOpeningFields>;

export function OpeningForm({ accounts, year, today }: {
  accounts: OpeningAccount[];
  year: { id: string; year: number; status: "OPEN" | "LOCKED" };
  today: string;
}) {
  const [mode, setMode] = useState<"simple" | "manual">("simple");
  const [preview, setPreview] = useState<OpeningPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<OpeningResult | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const request = useRef({ fingerprint: "", key: "" });
  const busy = useRef(false);
  const settings = useRef<HTMLDetailsElement>(null);
  const cashAccounts = accounts.filter(isOpeningCash);
  const capitalAccounts = accounts.filter(isOpeningCapital);
  const simple = useForm<SimpleValues, unknown, z.output<typeof simpleOpeningFields>>({
    resolver: zodResolver(simpleOpeningFields),
    defaultValues: {
      fiscalYearId: year.id,
      cutoverDate: `${year.year}-01-01`,
      cashAccountId: (cashAccounts.find(account => account.name === "Kas Besar") ?? cashAccounts[0])?.id ?? "",
      capitalAccountId: capitalAccounts.length === 1 ? capitalAccounts[0].id : "",
      amount: "",
      verificationNote: "",
    },
  });
  const manual = useForm<ManualValues, unknown, z.output<typeof openingFields>>({
    resolver: zodResolver(openingFields),
    defaultValues: {
      journalNumber: "", fiscalYearId: year.id, cutoverDate: today, verificationNote: "",
      lines: [{ accountId: "", side: "DEBIT", amount: "" }, { accountId: "", side: "CREDIT", amount: "" }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: manual.control, name: "lines" });
  const simpleErrors = simple.formState.errors;
  const manualErrors = manual.formState.errors;

  function inspect(values: unknown) {
    startTransition(async () => {
      setMessage("");
      try {
        const result = await (mode === "simple" ? previewSimpleOpeningAction(values) : previewOpeningAction(values));
        setMessage(result.message);
        if (result.ok && result.preview) { setPreview(result.preview); setConfirmed(false); }
      } catch { setMessage("Saldo awal belum dapat diperiksa. Belum ada jurnal disimpan."); }
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
      } catch {
        setMessage("Koneksi terputus. Ulangi Simpan dengan isi sama agar saldo tidak tercatat dua kali.");
      } finally { busy.current = false; }
    });
  }

  if (saved) return <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
    <h2 role="status" className="text-xl font-semibold">Saldo pembukaan tersimpan</h2>
    <p className="break-all font-mono">{saved.journalNumber}</p>
    <p className="text-sm">Saldo awal dan jurnalnya sudah tercatat. Pembukaan perusahaan cukup dilakukan satu kali.</p>
    <Button asChild><Link href={"/jurnal/" + saved.id}>Lihat jurnal pembukaan</Link></Button>
  </section>;

  if (preview) {
    const journal = <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
      <thead><tr><th className="p-3">Akun</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Kredit</th></tr></thead>
      <tbody>{preview.lines.map(line => <tr key={line.accountId} className="border-t">
        <td className="p-3">{line.code} · {line.name}</td>
        <td className="p-3 text-right tabular-nums">{formatRupiah(line.side === "DEBIT" ? line.amount : "0")}</td>
        <td className="p-3 text-right tabular-nums">{formatRupiah(line.side === "CREDIT" ? line.amount : "0")}</td>
      </tr>)}</tbody>
      <tfoot className="border-t font-semibold"><tr><td className="p-3">Total</td><td className="p-3 text-right">{formatRupiah(preview.totalDebit)}</td><td className="p-3 text-right">{formatRupiah(preview.totalCredit)}</td></tr></tfoot>
    </table></div>;
    return <section className="space-y-5 rounded-xl border bg-card p-5">
      <h2 className="text-xl font-semibold">Periksa saldo awal</h2>
      <p className="text-sm">Per {displayDate(preview.input.cutoverDate)} · Tahun Buku {preview.year}</p>
      {mode === "simple" ? <>
        <p className="break-words text-3xl font-semibold tabular-nums">{formatRupiah(preview.totalDebit)}</p>
        <p className="text-sm">Masuk ke <strong>{preview.lines[0].name}</strong> sebagai modal pemilik pada akun <strong>{preview.lines[1].name}</strong>.</p>
        <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Lihat jurnal otomatis</summary><div className="mt-3">{journal}</div></details>
      </> : journal}
      <p className="text-sm text-muted-foreground">Catatan: {preview.input.verificationNote}</p>
      <p className="text-sm text-muted-foreground">Nomor jurnal: {preview.input.journalNumber || "Dibuat otomatis saat disimpan"}. Pembukaan hanya satu kali per perusahaan.</p>
      <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
        <input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />
        <span>{mode === "simple"
          ? "Saldo, akun dan tanggal sudah benar. Uang ini berasal dari modal pemilik dan belum pernah dicatat di aplikasi."
          : "Saya sudah memverifikasi saldo, akun dan tanggal berdasarkan bukti, serta memastikan saldo belum pernah dicatat di aplikasi."}</span>
      </label>
      {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button loading={pending} disabled={pending || !confirmed} onClick={save}>{pending ? "Menyimpan…" : "Simpan saldo awal"}</Button>
        <Button variant="outline" disabled={pending} onClick={() => { setPreview(null); setConfirmed(false); setMessage(""); }}>Ubah isian</Button>
      </div>
    </section>;
  }

  return <section className="space-y-5 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap gap-2" role="group" aria-label="Cara mengisi saldo pembukaan">
      <Button variant={mode === "simple" ? "default" : "outline"} disabled={pending} aria-pressed={mode === "simple"} onClick={() => { setMode("simple"); setMessage(""); }}>Sederhana</Button>
      <Button variant={mode === "manual" ? "default" : "outline"} disabled={pending} aria-pressed={mode === "manual"} onClick={() => { setMode("manual"); setMessage(""); }}>Rincian per akun</Button>
    </div>
    <p className="text-sm text-muted-foreground">Tahun Buku {year.year} · {year.status === "OPEN" ? "Terbuka" : "Terkunci"}</p>
    {mode === "simple" ? <form className="space-y-5" noValidate onSubmit={event => {
      void simple.handleSubmit(inspect, errors => {
        if (settings.current && (errors.cashAccountId || errors.capitalAccountId || errors.cutoverDate || errors.verificationNote)) settings.current.open = true;
      })(event);
    }}>
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <div className="max-w-lg space-y-2">
          <Label htmlFor="opening-amount">Saldo kas/bank awal</Label>
          <Controller control={simple.control} name="amount" render={({ field }) => <MoneyInput id="opening-amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(simpleErrors.amount)} />} />
          <p className="text-sm text-muted-foreground">Isi satu nominal uang awal dari modal pemilik. Jurnal dibuat otomatis.</p>
          <p role="alert" className="text-sm text-destructive">{simpleErrors.amount?.message}</p>
        </div>
        <details ref={settings} className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">Pengaturan tanggal & akun</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="opening-date">Tanggal saldo awal</Label>
              <Input id="opening-date" type="date" min={`${year.year}-01-01`} max={`${year.year}-12-31`} {...simple.register("cutoverDate")} />
              <p role="alert" className="text-sm text-destructive">{simpleErrors.cutoverDate?.message}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opening-cash">Simpan saldo di</Label>
              <Controller control={simple.control} name="cashAccountId" render={({field})=><AccountSelect {...field} id="opening-cash" accounts={cashAccounts} placeholder="Pilih kas/bank" disabled={pending} invalid={Boolean(simpleErrors.cashAccountId)}/>}/>
              <p role="alert" className="text-sm text-destructive">{simpleErrors.cashAccountId?.message}</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="opening-capital">Modal milik</Label>
              <Controller control={simple.control} name="capitalAccountId" render={({field})=><AccountSelect {...field} id="opening-capital" accounts={capitalAccounts} placeholder="Pilih akun modal pemilik" disabled={pending} invalid={Boolean(simpleErrors.capitalAccountId)}/>}/>
              <p className="text-sm text-muted-foreground">Pilih pemilik yang sesuai dengan sumber uang awal.</p>
              <p role="alert" className="text-sm text-destructive">{simpleErrors.capitalAccountId?.message}</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="opening-note">Catatan / bukti saldo (opsional)</Label>
              <Input id="opening-note" {...simple.register("verificationNote")} maxLength={1000} placeholder="Contoh: saldo awal sesuai bukti setoran modal" />
              <p role="alert" className="text-sm text-destructive">{simpleErrors.verificationNote?.message}</p>
            </div>
          </div>
        </details>
        {(!cashAccounts.length || !capitalAccounts.length) && <p className="text-sm text-destructive">Akun kas/bank dan modal yang aktif serta disetujui diperlukan. Periksa daftar akun (COA) terlebih dahulu.</p>}
        <p className="text-sm text-muted-foreground">Untuk saldo lama dengan aset atau kewajiban lain, gunakan Rincian per akun.</p>
        {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button loading={pending} type="submit" disabled={pending || !cashAccounts.length || !capitalAccounts.length || year.status !== "OPEN"}>{pending ? "Memeriksa…" : "Periksa saldo awal"}</Button>
          <Button asChild variant="outline"><Link href="/">Lewati, mulai dari Rp0</Link></Button>
        </div>
      </fieldset>
    </form> : <form className="space-y-5" noValidate onSubmit={event => { void manual.handleSubmit(inspect)(event); }}>
      <fieldset disabled={pending} className="min-w-0 space-y-5">
        <p className="text-sm text-muted-foreground">Masukkan saldo tiap akun berdasarkan bukti. Total debit dan kredit harus sama.</p>
        <div className="space-y-2">
          <Label htmlFor="journalNumber">Nomor jurnal (opsional)</Label>
          <Input id="journalNumber" {...manual.register("journalNumber")} maxLength={40} placeholder="Kosongkan untuk nomor otomatis" autoComplete="off" />
          <p role="alert" className="text-sm text-destructive">{manualErrors.journalNumber?.message}</p>
        </div>
        <div className="max-w-sm space-y-2">
          <Label htmlFor="cutoverDate">Tanggal saldo awal</Label>
          <Input id="cutoverDate" type="date" min={`${year.year}-01-01`} max={`${year.year}-12-31`} {...manual.register("cutoverDate")} />
          <p role="alert" className="text-sm text-destructive">{manualErrors.cutoverDate?.message}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="verificationNote">Rujukan verifikasi saldo</Label>
          <textarea id="verificationNote" rows={3} className="w-full rounded-lg border p-3 text-sm" {...manual.register("verificationNote")} maxLength={1000} />
          <p role="alert" className="text-sm text-destructive">{manualErrors.verificationNote?.message}</p>
        </div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
          <thead><tr>{["Akun", "Posisi", "Nominal Rupiah", ""].map((text, index) => <th key={index} className="p-2">{text}</th>)}</tr></thead>
          <tbody>{fields.map((field, index) => <tr key={field.id} className="align-top">
            <td className="min-w-64 p-2">
              <Controller control={manual.control} name={`lines.${index}.accountId`} render={({field})=><AccountSelect {...field} accounts={accounts} aria-label={"Akun baris " + (index + 1)} disabled={pending} invalid={Boolean(manualErrors.lines?.[index]?.accountId)}/>}/>
              <p role="alert" className="text-destructive">{manualErrors.lines?.[index]?.accountId?.message}</p>
            </td>
            <td className="p-2"><select aria-label={"Posisi baris " + (index + 1)} className="h-11 rounded-lg border bg-background px-3" {...manual.register(`lines.${index}.side`)}><option value="DEBIT">Debit</option><option value="CREDIT">Kredit</option></select></td>
            <td className="min-w-48 p-2">
              <Label className="sr-only" htmlFor={"opening-amount-" + index}>{"Nominal Rupiah baris " + (index + 1)}</Label>
              <Controller control={manual.control} name={`lines.${index}.amount`} render={({ field }) => <MoneyInput id={"opening-amount-" + index} value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(manualErrors.lines?.[index]?.amount)} />} />
              <p role="alert" className="text-destructive">{manualErrors.lines?.[index]?.amount?.message}</p>
            </td>
            <td className="p-2"><Button variant="ghost" disabled={fields.length <= 2 || pending} onClick={() => remove(index)} aria-label={"Hapus baris " + (index + 1)}>Hapus</Button></td>
          </tr>)}</tbody>
        </table></div>
        <p role="alert" className="text-sm text-destructive">{manualErrors.lines?.root?.message ?? manualErrors.lines?.message}</p>
        <Button variant="outline" disabled={pending || fields.length >= 100} onClick={() => append({ accountId: "", side: "DEBIT", amount: "" })}>Tambah akun</Button>
        <p className="text-sm text-muted-foreground">Akun kontrol piutang, utang dan pinjaman karyawan memerlukan rincian subledger dan tidak tersedia di sini.</p>
        {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
        {!accounts.length && <p className="text-sm text-destructive">Belum ada akun aktif yang disetujui. Periksa COA terlebih dahulu.</p>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button loading={pending} type="submit" disabled={pending || !accounts.length || year.status !== "OPEN"}>{pending ? "Memeriksa…" : "Periksa saldo awal"}</Button>
          <Button asChild variant="outline"><Link href="/">Lewati, mulai dari Rp0</Link></Button>
        </div>
      </fieldset>
    </form>}
  </section>;
}
