"use client";
import Link from "@/components/year-link";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { journalFields, journalLineSchema, assertBalanced } from "@/lib/journal/validation";
import { MoneyInput } from "@/components/loans/money-input";
import { rupiah, formatInteger } from "@/lib/accounting/money";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AccountSelect } from "@/components/coa/account-select";
const formSchema = z.object({ ...journalFields, reason: z.string().trim().max(1000).default("") });
const schema = formSchema.superRefine((value,ctx)=>{try{assertBalanced(value.lines);}catch(error){ctx.addIssue({code:"custom",path:["lines"],message:(error as Error).message});}});
const openingSchema = formSchema.extend({ lines: z.array(journalLineSchema).min(1, "Isi minimal satu COA.").max(100) }).refine(value => new Set(value.lines.map(line => line.accountId)).size === value.lines.length, {path:["lines"], message:"Satu COA hanya boleh diisi satu kali."});
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;
export type JournalInitial = FormInput & { id: string; version: number };
export function JournalForm({ accounts, today, initial, fixedDate = false, perAccountOpening = false }: { accounts: { id: string; code: string; name: string; normalBalance?: "DEBIT" | "CREDIT" }[]; today: string; initial?: JournalInitial; fixedDate?: boolean; perAccountOpening?: boolean }) {
  const router = useRouter(), scopedHref=useFiscalHref(), request = useRef({ fingerprint: "", key: "" });
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");
  const { register, control, handleSubmit, setValue, setError, formState: { errors } } = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(perAccountOpening ? openingSchema : schema),
    defaultValues: initial ? {...initial,reason:""} : { journalNumber:"",reason:"",date: today, description: "", lines: [{ accountId: "", debit: "", credit: "", description: "" }, { accountId: "", debit: "", credit: "", description: "" }] } });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const lines = useWatch({ control, name: "lines" });
  function sum(side: "debit" | "credit") { try { return (lines ?? []).reduce((total, line) => total + BigInt(rupiah(line[side])), 0n); } catch { return 0n; } }
  const debit = sum("debit"), credit = sum("credit");
  function openingAmount(index: number) {
    const side = accounts.find(account => account.id === lines[index]?.accountId)?.normalBalance === "CREDIT" ? "credit" : "debit";
    return lines[index]?.[side] ?? "";
  }
  function setOpeningAmount(index: number, accountId: string, amount: string) {
    const credit = accounts.find(account => account.id === accountId)?.normalBalance === "CREDIT";
    setValue(`lines.${index}.debit`, credit ? "0" : amount);
    setValue(`lines.${index}.credit`, credit ? amount : "0");
  }
  function submit(value: FormOutput) {
    if(initial && value.reason.length<3){setError("reason",{message:"Tuliskan alasan perubahan, minimal 3 karakter."});return;}
    const {reason,...fields}=value;
    const payload = initial ? { ...fields, reason, id: initial.id, version: initial.version } : fields;
    const fingerprint = JSON.stringify(payload);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    startTransition(async () => {
      try {
      const response = await journalAction(initial ? "UPDATE" : "CREATE", { ...payload, requestKey: request.current.key });
      setMessage(response.message);
      if (response.ok && response.result) { router.push(scopedHref("/jurnal/" + response.result.id)); router.refresh(); }
      } catch { setMessage("Koneksi terputus. Coba Simpan lagi dengan isi yang sama; kunci permintaan tetap dipertahankan."); }
    });
  }
  return <form className="space-y-6 rounded-xl border bg-card p-5" onSubmit={event => { void handleSubmit(submit)(event); }} noValidate>
    <p className="rounded-lg bg-secondary p-4 text-sm">{perAccountOpening ? "Ubah saldo pembukaan langsung per COA tanpa akun lawan. Tambahkan COA yang belum diisi bila diperlukan. Tanggal pembukaan tetap." : "Menu lanjutan untuk pencatatan akuntansi manual. Catat piutang customer, utang supplier dan pinjaman karyawan melalui menu masing-masing agar rincian dan saldo kontrol selalu cocok."}</p>
    <div className="space-y-2"><Label htmlFor="journalNumber">Nomor jurnal</Label><Input id="journalNumber" {...register("journalNumber")} maxLength={40} placeholder="Contoh: JU/2026/001" autoComplete="off" /><p className="text-sm text-muted-foreground">Isi nomor yang unik. Huruf disimpan sebagai huruf besar.</p><p role="alert" className="text-sm text-destructive">{errors.journalNumber?.message}</p></div>
    <div className="grid gap-4 sm:grid-cols-[220px_1fr]"><div className="space-y-2"><Label htmlFor="date">Tanggal transaksi</Label><Input id="date" type="date" readOnly={fixedDate} {...register("date")} /><p role="alert" className="text-sm text-destructive">{errors.date?.message}</p></div>
      <div className="space-y-2"><Label htmlFor="description">Uraian jurnal</Label><Input id="description" {...register("description")} maxLength={2000} /><p role="alert" className="text-sm text-destructive">{errors.description?.message}</p></div></div>
    <div className="overflow-x-auto"><table className={"w-full text-left text-sm " + (perAccountOpening ? "min-w-[600px]" : "min-w-[800px]")}><caption className="sr-only">{perAccountOpening ? "Saldo pembukaan per COA" : "Rincian debit dan kredit"}</caption><thead><tr>{(perAccountOpening ? ["COA", "Keterangan baris (opsional)", "Saldo pembukaan (Rp)", ""] : ["Akun", "Keterangan baris (opsional)", "Debit (Rp)", "Kredit (Rp)", ""]).map((label, i) => <th key={i} className="p-2">{label}</th>)}</tr></thead><tbody>{fields.map((field, index) => <tr key={field.id} className="align-top">
      <td className="min-w-56 p-2"><Controller control={control} name={`lines.${index}.accountId`} render={({field})=><AccountSelect {...field} onChange={value => { const amount = openingAmount(index); field.onChange(value); if (perAccountOpening) setOpeningAmount(index, value, amount); }} accounts={accounts} aria-label={"Akun baris " + (index + 1)} invalid={Boolean(errors.lines?.[index]?.accountId)} disabled={pending}/>}/><p className="text-destructive">{errors.lines?.[index]?.accountId?.message}</p></td>
      <td className="p-2"><Input aria-label={"Keterangan baris " + (index + 1)} {...register(`lines.${index}.description`)} maxLength={500} /></td>
      {perAccountOpening ? <td className="relative min-w-48 p-2"><Label className="sr-only" htmlFor={"opening-edit-" + index}>{"Saldo pembukaan baris " + (index + 1)}</Label><MoneyInput id={"opening-edit-" + index} value={openingAmount(index)} onChange={value => setOpeningAmount(index, lines[index]?.accountId ?? "", value)} onBlur={() => {}} invalid={Boolean(errors.lines?.[index]?.debit || errors.lines?.[index]?.credit)} /><p className="text-destructive">{errors.lines?.[index]?.debit?.message ?? errors.lines?.[index]?.credit?.message}</p></td> : (["debit", "credit"] as const).map(side => <td key={side} className="min-w-36 p-2"><Input aria-label={(side === "debit" ? "Debit" : "Kredit") + " baris " + (index + 1)} inputMode="numeric" {...register(`lines.${index}.${side}`, { onBlur: event => { try { setValue(`lines.${index}.${side}`, formatInteger(rupiah(event.target.value))); } catch { /* Validation supplies the message. */ } } })} /><p className="text-destructive">{errors.lines?.[index]?.[side]?.message}</p></td>)}
      <td className="p-2"><Button type="button" variant="ghost" disabled={fields.length <= (perAccountOpening ? 1 : 2) || pending} onClick={() => remove(index)} aria-label={"Hapus baris " + (index + 1)}>Hapus</Button></td></tr>)}</tbody></table></div>
    <p role="alert" className="text-sm text-destructive">{errors.lines?.root?.message ?? errors.lines?.message}</p>
    <Button type="button" variant="outline" disabled={fields.length >= 100 || pending} onClick={() => append({ accountId: "", debit: "", credit: "", description: "" })}>Tambah baris</Button>
    <div className="rounded-lg border p-4 text-sm">{perAccountOpening ? <p>Saldo dicatat sesuai saldo normal COA tanpa akun lawan otomatis. Selisih neraca tetap ditampilkan bila saldo belum lengkap.</p> : <><p>Total debit: Rp {formatInteger(debit)} · Total kredit: Rp {formatInteger(credit)}</p><p className="mt-2">Selisih: Rp {formatInteger(debit - credit)}. Penyimpanan langsung memperbarui pembukuan. Total debit dan kredit harus seimbang dan positif.</p></>}</div>
    {initial && <div className="space-y-2"><Label htmlFor="reason">Alasan perubahan</Label><Input id="reason" {...register("reason")} maxLength={1000} /><p role="alert" className="text-sm text-destructive">{errors.reason?.message}</p></div>}
    {accounts.length === 0 && <p className="text-sm text-destructive">Belum ada akun aktif yang dapat digunakan. Periksa COA sebelum menyimpan.</p>}
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className="flex flex-col gap-3 sm:flex-row"><Button loading={pending} type="submit" disabled={pending || !accounts.length}>{pending ? "Menyimpan…" : initial ? "Simpan Perubahan" : "Simpan & Posting"}</Button><Button asChild variant="outline"><Link href={initial ? "/jurnal/" + initial.id : "/jurnal"}>Batal</Link></Button></div>
  </form>;
}
