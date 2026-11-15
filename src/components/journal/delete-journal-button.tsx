"use client";

import { useId, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, Trash2, X } from "lucide-react";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { Button } from "@/components/ui/button";

export function DeleteJournalButton({ id, version, journalNumber, small = false }: {
  id: string; version: number; journalNumber: string; small?: boolean;
}) {
  const router = useRouter(), scopedHref = useFiscalHref();
  const uid = useId(), dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const busy = useRef(false), request = useRef({ fingerprint: "", key: "" });
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState("");

  function open() {
    if (busy.current) return;
    setMessage("");
    dialog.current?.showModal();
    cancel.current?.focus();
  }

  function close() {
    if (!busy.current) dialog.current?.close();
  }

  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function submit() {
    if (busy.current) return;
    const fingerprint = JSON.stringify({ id, version });
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    busy.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        const response = await journalAction("DELETE", { id, version, requestKey: request.current.key });
        if (response.ok) {
          dialog.current?.close();
          router.replace(scopedHref("/jurnal?deleted=1"));
          router.refresh();
        } else setMessage(response.message);
      } catch { setMessage("Koneksi terputus. Silakan coba hapus lagi."); }
      finally { busy.current = false; }
    });
  }

  return <>
    <Button ref={trigger} variant={small ? "ghost" : "destructive"} size={small ? "sm" : "default"} className={small ? "text-destructive" : undefined} loading={pending} loadingText="Menghapus…" aria-haspopup="dialog" aria-controls={uid} onClick={open}>{small ? "Hapus" : "Hapus jurnal"}</Button>
    <dialog ref={dialog} id={uid} role="alertdialog" aria-modal="true" aria-labelledby={uid + "-title"} aria-describedby={`${uid}-number ${uid}-description ${uid}-warning`} data-print-hide
      onCancel={event => { if (busy.current) event.preventDefault(); }}
      onClose={() => trigger.current?.focus({ preventScroll: true })}
      onKeyDown={keepFocus} onClick={event => { if (event.target === event.currentTarget) close(); }}
      className="journal-delete-dialog fixed inset-0 m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl">
      <div className="relative px-6 pt-7 pb-6 sm:px-7">
        <Button variant="ghost" size="icon" className="absolute top-3 right-3 rounded-full text-muted-foreground hover:bg-muted" aria-label="Tutup konfirmasi" disabled={pending} onClick={close}><X className="size-5" aria-hidden="true" /></Button>
        <div className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-8 ring-destructive/5"><Trash2 className="size-6" aria-hidden="true" /></div>
        <h2 id={uid + "-title"} className="text-xl font-semibold tracking-tight">Hapus jurnal ini?</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">Pastikan jurnal berikut memang ingin Anda hapus.</p>
        <div id={uid + "-number"} className="mt-5 rounded-xl border bg-muted/50 p-4">
          <p className="text-xs font-medium text-muted-foreground">Nomor jurnal</p>
          <p className="mt-1.5 break-all font-mono text-sm font-semibold leading-6">{journalNumber}</p>
        </div>
        <p id={uid + "-description"} className="mt-4 text-sm leading-6 text-muted-foreground">Jurnal dan seluruh rinciannya akan dihapus. Saldo serta laporan diperbarui secara otomatis.</p>
        <div id={uid + "-warning"} className="mt-4 flex items-start gap-2.5 rounded-lg border border-destructive/15 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><p>Tindakan ini tidak dapat dibatalkan.</p>
        </div>
        {message && <p role="alert" className="mt-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{message}</p>}
      </div>
      <div className="flex flex-col-reverse gap-3 border-t bg-muted/50 px-6 py-4 sm:flex-row sm:px-7">
        <Button ref={cancel} variant="outline" className="flex-1 bg-card" disabled={pending} onClick={close}>Batal</Button>
        <Button variant="destructive" className="flex-1" loading={pending} loadingText="Menghapus…" onClick={submit}>{!pending && <Trash2 className="size-4" aria-hidden="true" />}Ya, hapus jurnal</Button>
      </div>
    </dialog>
  </>;
}
