"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeleteJournalButton({ id, version, journalNumber, small = false }: {
  id: string; version: number; journalNumber: string; small?: boolean;
}) {
  const router = useRouter(), scopedHref = useFiscalHref(), uid = useId();
  const dialog = useRef<HTMLDialogElement>(null), reasonInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false), request = useRef({ fingerprint: "", key: "" });
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const reason = reasonInput.current?.value.trim() ?? "";
    if (reason.length < 3) { setMessage("Tuliskan alasan penghapusan, minimal 3 karakter."); reasonInput.current?.focus(); return; }
    const fingerprint = JSON.stringify({ id, version, reason });
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        const response = await journalAction("DELETE", { id, version, reason, requestKey: request.current.key });
        if (response.ok) {
          dialog.current?.close();
          router.replace(scopedHref("/jurnal?deleted=1"));
          router.refresh();
        } else setMessage(response.message);
      } catch { setMessage("Koneksi terputus. Coba hapus lagi dengan alasan yang sama."); }
      finally { busy.current = false; }
    });
  }

  return <>
    <Button variant={small ? "ghost" : "destructive"} size={small ? "sm" : "default"} className={small ? "text-destructive" : undefined} onClick={() => {
      setMessage(""); dialog.current?.showModal(); reasonInput.current?.focus();
    }}>{small ? "Hapus" : "Hapus jurnal"}</Button>
    <dialog ref={dialog} aria-labelledby={uid + "-title"} aria-describedby={uid + "-description"} onCancel={event => { if (busy.current) event.preventDefault(); }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-card p-5 text-foreground shadow-xl backdrop:bg-black/50">
      <form onSubmit={submit} className="space-y-4">
        <h2 id={uid + "-title"} className="text-lg font-semibold">Hapus jurnal?</h2>
        <p className="break-all font-mono text-sm">{journalNumber}</p>
        <p id={uid + "-description"} className="text-sm text-muted-foreground">Jurnal dan seluruh barisnya akan dihapus dari pembukuan. Saldo dan laporan akan dihitung ulang. Tindakan ini tidak dapat dibatalkan; riwayat audit dan nomor jurnal tetap disimpan.</p>
        <div className="space-y-2"><Label htmlFor={uid + "-reason"}>Alasan penghapusan</Label><Input ref={reasonInput} id={uid + "-reason"} name="reason" required minLength={3} maxLength={1000} disabled={pending} aria-describedby={message ? uid + "-message" : undefined} /></div>
        {message && <p id={uid + "-message"} role="alert" className="text-sm text-destructive">{message}</p>}
        <div className="flex flex-wrap gap-3"><Button type="submit" variant="destructive" loading={pending} loadingText="Menghapus…">Ya, hapus jurnal</Button><Button variant="outline" disabled={pending} onClick={() => dialog.current?.close()}>Batal</Button></div>
      </form>
    </dialog>
  </>;
}
