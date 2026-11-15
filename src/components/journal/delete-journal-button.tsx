"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { Button } from "@/components/ui/button";

export function DeleteJournalButton({ id, version, journalNumber, small = false }: {
  id: string; version: number; journalNumber: string; small?: boolean;
}) {
  const router = useRouter(), scopedHref = useFiscalHref();
  const busy = useRef(false), request = useRef({ fingerprint: "", key: "" });
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");

  function submit() {
    if (busy.current) return;
    if (!window.confirm(`Hapus jurnal ${journalNumber}?\n\nJurnal dan seluruh barisnya akan dihapus. Saldo serta laporan akan diperbarui. Tindakan ini tidak dapat dibatalkan.`)) return;
    const fingerprint = JSON.stringify({ id, version });
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        const response = await journalAction("DELETE", { id, version, requestKey: request.current.key });
        if (response.ok) {
          router.replace(scopedHref("/jurnal?deleted=1"));
          router.refresh();
        } else setMessage(response.message);
      } catch { setMessage("Koneksi terputus. Silakan coba hapus lagi."); }
      finally { busy.current = false; }
    });
  }

  return <>
    <Button variant={small ? "ghost" : "destructive"} size={small ? "sm" : "default"} className={small ? "text-destructive" : undefined} loading={pending} loadingText="Menghapus…" onClick={submit}>{small ? "Hapus" : "Hapus jurnal"}</Button>
    {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
  </>;
}
