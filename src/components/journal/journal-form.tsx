"use client";
import Link from "@/components/year-link";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { draftFields } from "@/lib/journal/validation";
import { rupiah, formatInteger } from "@/lib/accounting/money";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
const schema = z.object(draftFields);
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;
export type JournalInitial = FormInput & { id: string; version: number; journalNumber: string };
export function JournalForm({ accounts, today, initial }: { accounts: { id: string; code: string; name: string }[]; today: string; initial?: JournalInitial }) {
  const router = useRouter(), scopedHref=useFiscalHref(), request = useRef({ fingerprint: "", key: "" });
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");
  const { register, control, handleSubmit, setValue, formState: { errors } } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(schema),
    defaultValues: initial ?? { date: today, description: "", lines: [{ accountId: "", debit: "", credit: "", description: "" }, { accountId: "", debit: "", credit: "", description: "" }] } });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });
  function sum(side: "debit" | "credit") { try { return (lines ?? []).reduce((total, line) => total + BigInt(rupiah(line[side])), 0n); } catch { return 0n; } }
  const debit = sum("debit"), credit = sum("credit");
  function submit(value: FormOutput) {
    const payload = initial ? { ...value, id: initial.id, version: initial.version } : value;
    const fingerprint = JSON.stringify(payload);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    startTransition(async () => {
      try {
      const response = await journalAction(initial ? "EDIT_DRAFT" : "CREATE_DRAFT", { ...payload, requestKey: request.current.key });
      setMessage(response.message);
      if (response.ok && response.result) { router.push(scopedHref("/jurnal/" + response.result.id)); router.refresh(); }
      } catch { setMessage("Koneksi terputus. Coba Simpan lagi dengan isi yang sama; kunci permintaan tetap dipertahankan."); }
    });
  }
  return <form className="space-y-6 rounded-xl border bg-card p-5" onSubmit={event => { void handleSubmit(submit)(event); }} noValidate>
    <p className="rounded-lg bg-secondary p-4 text-sm">Menu lanjutan untuk pencatatan akuntansi manual. Catat piutang customer, utang supplier dan pinjaman karyawan melalui menu masing-masing agar rincian dan saldo kontrol selalu cocok.</p>
    <p className="text-sm">Nomor jurnal: <strong>{initial?.journalNumber ?? "Dibuat otomatis saat draf disimpan"}</strong></p>
    <div className="grid gap-4 sm:grid-cols-[220px_1fr]"><div className="space-y-2"><Label htmlFor="date">Tanggal transaksi</Label><Input id="date" type="date" {...register("date")} /><p role="alert" className="text-sm text-destructive">{errors.date?.message}</p></div>
      <div className="space-y-2"><Label htmlFor="description">Uraian jurnal</Label><Input id="description" {...register("description")} maxLength={2000} /><p role="alert" className="text-sm text-destructive">{errors.description?.message}</p></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><caption className="sr-only">Rincian debit dan kredit</caption><thead><tr>{["Akun", "Keterangan baris (opsional)", "Debit (Rp)", "Kredit (Rp)", ""].map((label, i) => <th key={i} className="p-2">{label}</th>)}</tr></thead><tbody>{fields.map((field, index) => <tr key={field.id} className="align-top">
      <td className="min-w-56 p-2"><select aria-label={"Akun baris " + (index + 1)} className="h-11 w-full rounded-lg border bg-background px-2" {...register(`lines.${index}.accountId`)}><option value="">Pilih akun</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><p className="text-destructive">{errors.lines?.[index]?.accountId?.message}</p></td>
      <td className="p-2"><Input aria-label={"Keterangan baris " + (index + 1)} {...register(`lines.${index}.description`)} maxLength={500} /></td>
      {(["debit", "credit"] as const).map(side => <td key={side} className="min-w-36 p-2"><Input aria-label={(side === "debit" ? "Debit" : "Kredit") + " baris " + (index + 1)} inputMode="numeric" {...register(`lines.${index}.${side}`, { onBlur: event => { try { setValue(`lines.${index}.${side}`, formatInteger(rupiah(event.target.value))); } catch { /* Validation supplies the message. */ } } })} /><p className="text-destructive">{errors.lines?.[index]?.[side]?.message}</p></td>)}
      <td className="p-2"><Button type="button" variant="ghost" disabled={fields.length <= 2 || pending} onClick={() => remove(index)} aria-label={"Hapus baris " + (index + 1)}>Hapus</Button></td></tr>)}</tbody></table></div>
    <p role="alert" className="text-sm text-destructive">{errors.lines?.root?.message ?? errors.lines?.message}</p>
    <Button type="button" variant="outline" disabled={fields.length >= 100 || pending} onClick={() => append({ accountId: "", debit: "", credit: "", description: "" })}>Tambah baris</Button>
    <div className="rounded-lg border p-4 text-sm"><p>Total debit: Rp {formatInteger(debit)} · Total kredit: Rp {formatInteger(credit)}</p><p className="mt-2">Selisih: Rp {formatInteger(debit - credit)}. Draf belum memengaruhi saldo. Posting memerlukan jurnal seimbang dan total positif.</p></div>
    {accounts.length === 0 && <p className="text-sm text-destructive">Belum ada akun aktif yang dapat digunakan. Periksa COA sebelum menyimpan.</p>}
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className="flex gap-3"><Button loading={pending} type="submit" disabled={pending || !accounts.length}>{pending ? "Menyimpan…" : "Simpan draf"}</Button><Button asChild variant="outline"><Link href={initial ? "/jurnal/" + initial.id : "/jurnal"}>Batal</Link></Button></div>
  </form>;
}
