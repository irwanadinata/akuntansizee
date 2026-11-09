"use client";
import { useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm,Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "@/components/year-link";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { sourceEditSchema,type SourceEditInput,type SourceEditValues } from "@/lib/journal/source-validation";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { MoneyInput } from "@/components/loans/money-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function SourceEditForm({initial,accounts,relatedLabel,relatedHref}:{initial:SourceEditInput;accounts:{id:string;name:string}[];relatedLabel:string;relatedHref:string}) {
 const router=useRouter(),href=useFiscalHref(),request=useRef({fingerprint:"",key:""}),busy=useRef(false);
 const [pending,startTransition]=useTransition(),[message,setMessage]=useState("");
 const {register,control,handleSubmit,formState:{errors}}=useForm<SourceEditInput,unknown,SourceEditValues>({resolver:zodResolver(sourceEditSchema),defaultValues:initial});
 const errorMap=errors as Record<string,{message?:string}>;
 const error=(field:string)=><p role="alert" className="text-sm text-destructive">{errorMap[field]?.message}</p>;
 const parent=initial.sourceType==="LOAN"||initial.sourceType==="TRADE_DOCUMENT";
 const isLoan=initial.sourceType==="LOAN",isDocument=initial.sourceType==="TRADE_DOCUMENT";
 const accountField=isDocument?"counterAccountId":"cashAccountId";
 function save(value:SourceEditValues){
  if(busy.current)return;
  const payload={...value,requestKey:undefined},fingerprint=JSON.stringify(payload);
  if(request.current.fingerprint!==fingerprint)request.current={fingerprint,key:crypto.randomUUID()};
  busy.current=true;
  startTransition(async()=>{try{const response=await journalAction("UPDATE_SOURCE",{...payload,requestKey:request.current.key});setMessage(response.message);if(response.ok){router.push(href("/jurnal/"+initial.id));router.refresh();}}catch{setMessage("Koneksi terputus. Ulangi dengan isian yang sama; perubahan tidak tersimpan dua kali.");}finally{busy.current=false;}});
 }
 return <form onSubmit={event=>{void handleSubmit(save)(event);}} noValidate className="max-w-3xl space-y-5 rounded-xl border bg-card p-5 sm:p-7">
  <p className="rounded-lg bg-secondary p-4 text-sm">Perubahan disimpan bersama pada transaksi asal dan jurnal otomatisnya. Saldo serta laporan langsung diperbarui. Riwayat nilai sebelum dan sesudah perubahan tetap tersimpan.</p>
  <p className="text-sm"><Link href={relatedHref} className="text-primary underline">{relatedLabel}</Link></p>
  <fieldset disabled={pending} className="space-y-5">
   <div className="space-y-2"><Label htmlFor="journalNumber">Nomor jurnal</Label><Input id="journalNumber" {...register("journalNumber")} maxLength={40} />{error("journalNumber")}</div>
   {isLoan&&<div className="space-y-2"><Label htmlFor="employeeName">Nama karyawan</Label><Input id="employeeName" {...register("employeeName")} maxLength={200}/>{error("employeeName")}</div>}
   {isDocument&&<div className="space-y-2"><Label htmlFor="partyName">{initial.kind==="RECEIVABLE"?"Nama customer":"Nama supplier"}</Label><Input id="partyName" {...register("partyName")} maxLength={200}/>{error("partyName")}</div>}
   <div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="date">Tanggal transaksi</Label><Input id="date" type="date" {...register("date")}/>{error("date")}</div>{parent&&<div className="space-y-2"><Label htmlFor="dueDate">Jatuh tempo (opsional)</Label><Input id="dueDate" type="date" {...register("dueDate")}/>{error("dueDate")}</div>}</div>
   <div className="space-y-2"><Label htmlFor="amount">Nominal (Rp)</Label><Controller control={control} name="amount" render={({field})=><MoneyInput id="amount" value={field.value} onChange={field.onChange} onBlur={field.onBlur} invalid={Boolean(errorMap.amount)}/>}/>{error("amount")}</div>
   <div className="space-y-2"><Label htmlFor={accountField}>{isDocument?(initial.kind==="RECEIVABLE"?"Akun pendapatan":"Kategori pengeluaran"):"Akun Kas/Bank"}</Label><select id={accountField} {...register(accountField)} className="h-11 w-full rounded-lg border bg-background px-3 text-sm"><option value="">Pilih akun</option>{accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>{error(accountField)}</div>
   {isDocument&&<div className="space-y-2"><Label htmlFor="externalReference">Referensi luar (opsional)</Label><Input id="externalReference" {...register("externalReference")} maxLength={100}/>{error("externalReference")}</div>}
   <div className="space-y-2"><Label htmlFor="notes">Catatan (opsional)</Label><textarea id="notes" {...register("notes")} maxLength={1000} rows={3} className="w-full rounded-lg border bg-background p-3 text-sm"/>{error("notes")}</div>
   <div className="space-y-2"><Label htmlFor="reason">Alasan perubahan</Label><Input id="reason" {...register("reason")} maxLength={1000}/>{error("reason")}</div>
  </fieldset>
  {message&&<p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
  <div className="flex flex-wrap gap-3"><Button type="submit" loading={pending} disabled={pending}>Simpan Perubahan</Button><Button asChild variant="outline" disabled={pending}><Link href={"/jurnal/"+initial.id}>Batal</Link></Button></div>
 </form>;
}
