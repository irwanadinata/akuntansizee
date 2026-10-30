"use client";
import Link from "@/components/year-link";
import { useRef, useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { loanFields, paymentFields } from "@/lib/loans/validation";
import { loanAction } from "@/app/(admin)/pinjaman-karyawan/actions";
import { formatRupiah } from "@/lib/accounting/money";
import { displayDate } from "@/lib/accounting/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "./money-input";
import { usePanelForm } from "@/components/transactions/panel-context";
import { CreationCancel } from "@/components/transactions/creation-link";
import { cn } from "@/lib/utils";
const formSchema = paymentFields.extend({ employeeName: z.string().default(""), dueDate: z.string().default("") });
type Values = z.output<typeof formSchema>;
type InputValues = z.input<typeof formSchema>;
export function LoanForm({ accounts,today,loan }: { accounts:{id:string;name:string}[];today:string;loan?:{id:string;employeeName:string;remaining:string} }) {
  const [review,setReview]=useState<Values|null>(null), [message,setMessage]=useState(""), [saved,setSaved]=useState<{id:string;number:string}|null>(null), [pending,startTransition]=useTransition();
  const request=useRef({fingerprint:"",key:""});
  const { register,control,handleSubmit,setError,formState:{errors,isDirty} }=useForm<InputValues,unknown,Values>({ resolver:zodResolver(formSchema),defaultValues:{ date:today,amount:"",cashAccountId:"",notes:"",employeeName:loan?.employeeName ?? "",dueDate:"" } });
  const panel=usePanelForm({dirty:isDirty||review!==null,pending,saved:Boolean(saved)});
  const surface=panel?"space-y-5":"max-w-2xl space-y-5 rounded-xl border bg-card p-5 sm:p-7";
  const actions=cn("flex flex-wrap gap-3",panel&&"transaction-panel-actions");
  function preview(values:Values) {
    if (!loan) { const parsed=loanFields.safeParse(values); if(!parsed.success) { for(const issue of parsed.error.issues) setError(issue.path[0] as keyof Values,{message:issue.message}); return; } }
    if(loan && BigInt(values.amount)>BigInt(loan.remaining)) { setError("amount",{message:"Jumlah melebihi sisa yang ditampilkan. Muat ulang bila sisa berubah."}); return; }
    setMessage("");setReview(loan?values:loanFields.parse(values));
  }
  function save() {
    if(!review) return;
    const { employeeName,dueDate,...payment }=review;
    const payload=loan ? {...payment,loanId:loan.id} : {...payment,employeeName,dueDate};
    const fingerprint=JSON.stringify(payload); if(request.current.fingerprint!==fingerprint) request.current={fingerprint,key:crypto.randomUUID()};
    startTransition(async()=>{ try { const response=await loanAction(loan ? "CREATE_PAYMENT":"CREATE_LOAN",{...payload,requestKey:request.current.key});setMessage(response.message);if(response.ok && response.result) setSaved({id:response.result.loanId,number:response.result.number}); } catch { setMessage("Koneksi terputus. Tekan Simpan lagi dengan isi sama; kunci permintaan dipertahankan agar tidak tercatat dua kali."); } });
  }
  if(saved) return <div className={panel?"space-y-5 pb-6":"space-y-5 rounded-xl border bg-card p-6"}><h2 className="text-lg font-semibold" role="status">{message}</h2><p className="break-all font-mono text-sm">{saved.number}</p><p className="text-sm text-muted-foreground">Transaksi dan jurnal otomatis sudah tersimpan bersama.</p><div className="flex flex-wrap gap-3">{panel&&<Button disabled={pending} onClick={panel.dismiss}>Selesai</Button>}<Button asChild variant={panel?"outline":"default"}><Link href={"/pinjaman-karyawan/"+saved.id}>Lihat cicilan & sisa pinjaman</Link></Button></div></div>;
  if(review) return <section className={surface}><h2 className="text-lg font-semibold">Periksa sebelum mencatat</h2><p>{loan ? "Cicilan " + loan.employeeName + " sebesar " : review.employeeName+" menerima pinjaman "}<strong>{formatRupiah(review.amount)}</strong>.</p><p className="text-sm">{loan ? "Uang diterima di: ":"Uang dikeluarkan dari: "}{accounts.find(account=>account.id===review.cashAccountId)?.name}. Tanggal: {displayDate(review.date)}.</p>{loan && <p className="text-sm">Sisa setelah cicilan: {formatRupiah(BigInt(loan.remaining)-BigInt(review.amount))}. Sisa diperiksa kembali saat Simpan.</p>}<p className="text-sm text-muted-foreground">Setelah dicatat, koreksi dilakukan melalui pembatalan dengan jurnal pembalik.</p>{message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}<div className={actions}><Button loading={pending} disabled={pending} onClick={save}>{pending?"Menyimpan…":"Simpan & Catat"}</Button><Button variant="outline" disabled={pending} onClick={()=>setReview(null)}>Ubah isian</Button></div></section>;
  const error=(name:keyof Values)=><p className="text-sm text-destructive" role="alert">{errors[name]?.message}</p>;
  return <form className={surface} onSubmit={event=>{void handleSubmit(preview)(event);}} noValidate>
    {loan ? <div><p className="font-semibold">{loan.employeeName}</p><p className="mt-2 text-sm">Sisa pinjaman {formatRupiah(loan.remaining)}</p></div>:<div className="space-y-2"><Label htmlFor="employeeName">Nama karyawan</Label><Input id="employeeName" {...register("employeeName")} maxLength={200}/>{error("employeeName")}</div>}
    <div className="space-y-2"><Label htmlFor="date">{loan?"Tanggal cicilan":"Tanggal pinjam"}</Label><Input id="date" type="date" {...register("date")}/>{error("date")}</div>
    <div className="space-y-2"><Label htmlFor="amount">{loan?"Jumlah cicilan":"Jumlah pinjaman"}</Label><Controller control={control} name="amount" render={({field})=><MoneyInput id="amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(errors.amount)}/>}/>{error("amount")}<p className="text-sm text-muted-foreground">Dalam Rupiah, tanpa pecahan.</p></div>
    <div className="space-y-2"><Label htmlFor="cashAccountId">{loan?"Uang diterima di":"Uang dikeluarkan dari"}</Label><select id="cashAccountId" className="h-11 w-full rounded-lg border bg-background px-3 text-sm" {...register("cashAccountId")}><option value="">Pilih Kas/Bank</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>{error("cashAccountId")}</div>
    <div className="space-y-2"><Label htmlFor="notes">Catatan (opsional)</Label><textarea id="notes" rows={3} className="w-full rounded-lg border bg-background p-3 text-sm" {...register("notes")} maxLength={1000}/>{error("notes")}</div>
    {!loan && <div className="space-y-2"><Label htmlFor="dueDate">Jatuh tempo (opsional)</Label><Input id="dueDate" type="date" {...register("dueDate")}/>{error("dueDate")}</div>}
    {!accounts.length && <p className="text-sm text-destructive">Belum ada Kas/Bank aktif yang tersedia. Periksa COA.</p>}
    <p className="text-sm text-muted-foreground">Nomor dibuat otomatis setelah Simpan. Tidak perlu mengisi debit/kredit atau membuat akun karyawan.</p>
    <div className={actions}><Button type="submit" disabled={!accounts.length}>Periksa & lanjutkan</Button><CreationCancel href={loan?"/pinjaman-karyawan/"+loan.id:"/pinjaman-karyawan"}/></div>
  </form>;
}
