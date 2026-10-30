"use client";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { useState,useTransition } from "react";
import { CalendarDays, ChevronDown, LoaderCircle } from "lucide-react";
import { selectFiscalYear } from "@/app/(admin)/tahun-buku/selection-actions";
import { selectedYear,requiresSingleFiscalYear,type YearOption } from "@/lib/fiscal/selection";
export function FiscalYearSelector({years,fallback}:{years:YearOption[];fallback:string}) {
  const path=usePathname(),params=useSearchParams(),router=useRouter(),[pending,startTransition]=useTransition(),[message,setMessage]=useState("");
  const allowAll=!requiresSingleFiscalYear(path);
  const active=selectedYear(params.get("year")??undefined,years,fallback,allowAll),status=years.find(year=>String(year.year)===active)?.status;
  return <div className="min-w-0">
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
      {pending?<LoaderCircle className="size-5 shrink-0 animate-spin text-primary" aria-hidden="true"/>:<CalendarDays className="size-5 shrink-0 text-primary" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <label htmlFor="active-fiscal-year" className="block text-xs text-muted-foreground">Tahun buku</label>
        <div className="relative">
          <select id="active-fiscal-year" aria-label="Tahun buku aktif" aria-describedby="active-year-status" className="block h-6 w-full min-w-0 appearance-none truncate border-0 bg-transparent pr-5 text-sm font-semibold outline-none disabled:cursor-wait disabled:opacity-60" value={active||"all"} disabled={pending||!years.length} onChange={event=>{const value=event.target.value;startTransition(async()=>{try{const result=await selectFiscalYear(value);setMessage(result.ok?"":result.message);if(result.ok){const next=new URLSearchParams(params.toString());next.set("year",value);for(const key of["from","to","asOf","page","fiscalYearId"])next.delete(key);router.push(path+"?"+next);router.refresh();}}catch{setMessage("Pilihan belum tersimpan. Coba kembali.");}});}}>{allowAll&&<option value="all">Semua tahun</option>}{!years.length&&<option value="all">Belum ada tahun</option>}{years.map(year=><option key={year.id} value={year.year}>{year.year} · {year.status==="OPEN"?"Terbuka":"Terkunci"}</option>)}</select>
          <ChevronDown className="pointer-events-none absolute top-1 right-0 size-4 text-muted-foreground" aria-hidden="true" />
        </div>
      </div>
    </div>
    <p id="active-year-status" role="status" className="sr-only">{pending?"Memuat Tahun Buku…":status==="LOCKED"?"Tahun terkunci. Laporan tetap dapat dibaca.":status==="OPEN"?"Tahun terbuka untuk pencatatan.":"Menampilkan semua tahun."}</p>
    {message&&<p role="status" className="mt-1 text-xs text-destructive">{message}</p>}
  </div>;
}
