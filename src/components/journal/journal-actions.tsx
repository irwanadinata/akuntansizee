"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function JournalActions({ id, version, status, source, today }: { id: string; version: number; status: string; source: string; today: string }) {
  const router = useRouter(), scopedHref=useFiscalHref(), keys = useRef(new Map<string, string>());
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");
  const [operation, setOperation] = useState("");
  const [reason, setReason] = useState(""), [date, setDate] = useState(today), [confirmDelete, setConfirmDelete] = useState(false);
  function run(operation: "POST" | "DELETE_DRAFT" | "REVERSE") {
    setOperation(operation);
    const input = { id, version, ...(operation === "REVERSE" ? { date, reason } : {}) };
    const hash = operation + JSON.stringify(input);
    if (!keys.current.has(hash)) keys.current.set(hash, crypto.randomUUID());
    startTransition(async () => {
      try {
      const response = await journalAction(operation, { ...input, requestKey: keys.current.get(hash) });
      setMessage(response.message);
      if (response.ok) { if (operation === "DELETE_DRAFT") router.push(scopedHref("/jurnal")); else if (operation === "REVERSE" && response.result) router.push(scopedHref("/jurnal/" + response.result.id)); router.refresh(); }
      } catch { setMessage("Koneksi terputus. Ulangi tindakan dengan isi yang sama; kunci permintaan tetap dipertahankan."); }
    });
  }
  return <div className="space-y-4 rounded-xl border bg-card p-5">
    {status === "DRAFT" && <><p className="text-sm">Posting memasukkan jurnal ke pembukuan secara permanen. Periksa akun, tanggal dan nominal terlebih dahulu.</p><Button loading={pending && operation === "POST"} loadingText="Memposting…" disabled={pending} onClick={() => run("POST")}>Posting jurnal</Button><div className="space-y-3 border-t pt-4"><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmDelete} onChange={event => setConfirmDelete(event.target.checked)} />Saya ingin menghapus draf ini. Nomornya tetap dicatat dalam audit.</label><Button loading={pending && operation === "DELETE_DRAFT"} loadingText="Menghapus…" variant="outline" disabled={pending || !confirmDelete} onClick={() => run("DELETE_DRAFT")}>Hapus draf</Button></div></>}
    {status === "POSTED" && source === "MANUAL" && <form className="space-y-3" onSubmit={event => { event.preventDefault(); run("REVERSE"); }}><h2 className="font-semibold">Batalkan melalui jurnal pembalik</h2><p className="text-sm text-muted-foreground">Jurnal asal tetap tersimpan. Pembalik menukar debit dan kredit pada tanggal yang dipilih di periode terbuka.</p><Label htmlFor="reverse-date">Tanggal pembalik</Label><Input id="reverse-date" type="date" value={date} onChange={event => setDate(event.target.value)} required /><Label htmlFor="reason">Alasan pembatalan</Label><Input id="reason" value={reason} onChange={event => setReason(event.target.value)} minLength={3} maxLength={1000} required /><Button loading={pending && operation === "REVERSE"} loadingText="Membatalkan…" type="submit" disabled={pending}>Buat & posting pembalik</Button></form>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
