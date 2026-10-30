"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function DownloadPdfButton({href,children="Unduh PDF"}:{href:string;children?:string}) {
  const [pending,setPending]=useState(false),[message,setMessage]=useState("");
  const active=useRef<AbortController|null>(null);
  useEffect(()=>()=>active.current?.abort("unmount"),[]);
  async function download(){
    if(active.current)return;
    const controller=new AbortController();active.current=controller;setPending(true);setMessage("");
    const timeout=setTimeout(()=>controller.abort("timeout"),120000);
    try{
      const url=new URL(href,window.location.origin);
      if(url.origin!==window.location.origin||url.pathname!=="/laporan-keuangan/pdf")throw new Error("Invalid export target");
      const response=await fetch(url,{credentials:"same-origin",cache:"no-store",signal:controller.signal});
      if(response.redirected){setMessage("Sesi mungkin telah berakhir. Masuk kembali sebelum mengunduh PDF.");return;}
      if(!response.ok){const error=await response.json().catch(()=>null);setMessage(typeof error?.error==="string"?error.error.slice(0,300):"PDF belum dapat diunduh. Coba lagi.");return;}
      if(!response.headers.get("content-type")?.includes("application/pdf"))throw new Error("Unexpected response type");
      const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),link=document.createElement("a");
      const filename=response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1];
      link.href=objectUrl;link.download=filename&&/^[a-zA-Z0-9._-]{1,150}\.pdf$/.test(filename)?filename:"laporan-keuangan.pdf";
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);setMessage("PDF siap diunduh.");
    }catch{if(controller.signal.reason!=="unmount")setMessage(controller.signal.aborted?(controller.signal.reason==="timeout"?"Penyiapan PDF terlalu lama. Persempit periode lalu coba lagi.":"Unduhan dibatalkan."):"PDF belum dapat diunduh. Periksa koneksi lalu coba lagi.");}
    finally{clearTimeout(timeout);if(controller.signal.reason!=="unmount")setPending(false);if(active.current===controller)active.current=null;}
  }
  return <div className="max-w-full space-y-2" data-pdf-download>
    <div className="flex flex-wrap gap-2"><Button loading={pending} loadingText="Menyiapkan PDF…" onClick={()=>{void download();}}>{children}</Button>{pending&&<Button variant="outline" onClick={()=>active.current?.abort("cancel")}>Batalkan unduhan</Button>}</div>
    <p role="status" className="max-w-md text-sm text-muted-foreground">{pending?"Laporan sedang disiapkan sesuai filter. Mohon tunggu…":message}</p>
  </div>;
}
