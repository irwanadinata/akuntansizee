"use client";
import { useRouter } from "next/navigation";
import { useRef,useState,useTransition } from "react";
import { loanAction } from "@/app/(admin)/pinjaman-karyawan/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
export function ReverseLoanForm({id,payment,today}:{id:string;payment?:boolean;today:string}) {
  const router=useRouter(),request=useRef({fingerprint:"",key:""});
  const [date,setDate]=useState(today),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[pending,startTransition]=useTransition(),[message,setMessage]=useState("");
  return <details className="rounded-lg border p-4"><summary className="cursor-pointer text-sm font-medium">Batalkan {payment?"cicilan":"pinjaman"}</summary><form className="mt-4 max-w-lg space-y-3" onSubmit={event=>{event.preventDefault();const payload={id,date,reason},fingerprint=JSON.stringify(payload);if(request.current.fingerprint!==fingerprint)request.current={fingerprint,key:crypto.randomUUID()};startTransition(async()=>{try{const response=await loanAction(payment?"REVERSE_PAYMENT":"REVERSE_LOAN",{...payload,requestKey:request.current.key});setMessage(response.message);if(response.ok)router.refresh();}catch{setMessage("Koneksi terputus. Ulangi dengan isi yang sama.");}});}}>
    <p className="text-sm text-muted-foreground">Pembatalan membuat jurnal pembalik dan mempertahankan histori. {payment?"Sisa pinjaman akan bertambah kembali.":"Semua cicilan aktif harus dibatalkan dahulu."}</p><Label htmlFor={"reverse-date-"+id}>Tanggal pembatalan</Label><Input id={"reverse-date-"+id} type="date" value={date} onChange={event=>setDate(event.target.value)} required/><Label htmlFor={"reason-"+id}>Alasan pembatalan</Label><Input id={"reason-"+id} value={reason} onChange={event=>setReason(event.target.value)} minLength={3} maxLength={1000} required/><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>Saya sudah memeriksa dan ingin membatalkan transaksi ini.</label><Button loading={pending} type="submit" disabled={pending || !confirmed} variant="outline">{pending?"Menyimpan…":"Simpan pembatalan"}</Button>{message&&<p role="status" className="text-sm">{message}</p>}</form></details>;
}
