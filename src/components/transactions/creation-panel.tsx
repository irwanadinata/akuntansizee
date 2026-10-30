"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle, Plus, X } from "lucide-react";
import { loadCreationForm } from "@/app/(admin)/creation-actions";
import { useFiscalContext } from "@/components/fiscal-context";
import { LoanForm } from "@/components/loans/loan-form";
import { TradeDocumentForm } from "@/components/trade/document-form";
import { AccountForm } from "@/components/coa/account-form";
import { Button } from "@/components/ui/button";
import { requiresSingleFiscalYear, selectedYear } from "@/lib/fiscal/selection";
import { creationOptions, type CreationData, type CreationKind } from "@/lib/transactions/creation";
import { CreationPanelContext, PanelFormContext, type PanelFormState } from "./panel-context";

type Selection = { kind: CreationKind; year: string; data?: CreationData; error?: string };
const cleanForm: PanelFormState = { dirty: false, pending: false, saved: false };

export function CreationPanelProvider({ children }: { children: ReactNode }) {
  const router = useRouter(), pathname = usePathname(), search = useSearchParams(), fiscal = useFiscalContext();
  const allowAll = !requiresSingleFiscalYear(pathname);
  const year = selectedYear(search.get("year") ?? undefined, fiscal.years, allowAll ? fiscal.preferredYear : fiscal.defaultYear, allowAll) || "all";
  const location = pathname + "?" + search.toString();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [formState, setFormState] = useState(cleanForm);
  const [confirmClose, setConfirmClose] = useState(false);
  const modal = useRef<HTMLDialogElement>(null), confirmation = useRef<HTMLElement>(null), resumeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null), previousFocus = useRef<HTMLElement | null>(null);
  const sequence = useRef(0), savedRefreshed = useRef(false), state = useRef(cleanForm), lastLocation = useRef(location);
  const isOpen = selection !== null;
  const cancelPendingLoad = useCallback(() => { sequence.current++; }, []);

  const forceClose = useCallback(() => {
    sequence.current++;
    modal.current?.close();
    setSelection(null); setConfirmClose(false); setFormState(cleanForm); state.current = cleanForm;
    const target = opener.current;
    requestAnimationFrame(() => { if (target?.isConnected) target.focus({ preventScroll: true }); });
  }, []);

  const dismiss = useCallback(() => {
    if (state.current.pending) return;
    if (state.current.dirty && !state.current.saved) {
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setConfirmClose(true);
    } else forceClose();
  }, [forceClose]);

  const fetchForm = useCallback(async (kind: CreationKind, selected: string, request: number) => {
    try {
      const response = await loadCreationForm({ kind, year: selected });
      if (request !== sequence.current) return;
      setSelection(response.ok ? { kind, year: selected, data: response.data } : { kind, year: selected, error: response.message });
    } catch {
      if (request === sequence.current) setSelection({ kind, year: selected, error: "Formulir belum dapat dimuat. Periksa koneksi lalu coba lagi." });
    }
  }, []);

  const open = useCallback((kind: CreationKind) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    state.current = cleanForm; setFormState(cleanForm); setConfirmClose(false); savedRefreshed.current = false;
    setSelection({ kind, year });
    void fetchForm(kind, year, ++sequence.current);
  }, [fetchForm, year]);

  const report = useCallback((next: PanelFormState) => {
    state.current = next;
    setFormState(previous => previous.dirty === next.dirty && previous.pending === next.pending && previous.saved === next.saved ? previous : next);
    if (next.saved && !savedRefreshed.current) { savedRefreshed.current = true; router.refresh(); }
  }, [router]);

  useEffect(() => {
    if (!isOpen) return;
    const node = modal.current;
    node?.showModal();
    return () => { cancelPendingLoad(); node?.close(); };
  }, [isOpen, cancelPendingLoad]);

  useEffect(() => {
    if (!selection?.data) return;
    const frame = requestAnimationFrame(() => modal.current?.querySelector<HTMLInputElement>("input:not([type=hidden])")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [selection?.data]);

  useEffect(() => { if (confirmClose) resumeButton.current?.focus(); }, [confirmClose]);
  useEffect(() => {
    if (lastLocation.current === location) return;
    lastLocation.current = location;
    if (modal.current?.open) forceClose();
  }, [location, forceClose]);

  function resume() {
    setConfirmClose(false);
    requestAnimationFrame(() => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); });
  }

  function containFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const scope = confirmClose ? confirmation.current : modal.current;
    const targets = [...(scope?.querySelectorAll<HTMLElement>("a[href],button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex='-1'])") ?? [])].filter(element => element.getClientRects().length > 0);
    const first = targets[0], last = targets[targets.length - 1];
    if (!first || !last) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  const context = useMemo(() => ({ open }), [open]);
  const formContext = useMemo(() => ({ dismiss, report }), [dismiss, report]);
  const options = selection ? creationOptions[selection.kind] : null;
  const loading = Boolean(selection && !selection.data && !selection.error);

  return <CreationPanelContext.Provider value={context}>
    {children}
    <dialog ref={modal} data-print-hide data-creation-panel data-panel-kind={selection?.kind} aria-labelledby="creation-panel-title" aria-describedby="creation-panel-description" onKeyDown={containFocus} onCancel={event => { event.preventDefault(); if (confirmClose) resume(); else dismiss(); }} onClick={event => { if (event.target === event.currentTarget && !confirmClose) dismiss(); }} className="transaction-panel fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-none overflow-hidden border-0 bg-background p-0 text-foreground shadow-2xl sm:w-[min(680px,90vw)] sm:rounded-l-2xl sm:border-l">
      {selection && options && <>
        <div className="flex h-full flex-col" inert={confirmClose}>
          <header className="flex shrink-0 items-start gap-3 border-b bg-background px-5 py-5 sm:px-6">
            <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary"><Plus className="size-5" aria-hidden="true" /></span>
            <div className="min-w-0 flex-1"><p className="mb-1 text-xs font-semibold text-primary">{selection.kind === "account" ? "Daftar akun" : "Catat transaksi"}</p><h2 id="creation-panel-title" className="text-xl font-semibold tracking-tight">{options.title}</h2><p id="creation-panel-description" className="mt-2 text-sm leading-6 text-muted-foreground">{options.description}</p></div>
            <Button variant="ghost" size="icon" disabled={formState.pending} aria-label="Tutup formulir" onClick={dismiss}><X aria-hidden="true" /></Button>
          </header>
          <div className="transaction-panel-body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 sm:px-6 sm:pt-6" aria-busy={loading || formState.pending}>
            {loading && <div role="status" className="flex items-center gap-3 rounded-xl border bg-muted/40 p-5 text-sm text-muted-foreground"><LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />Menyiapkan formulir…</div>}
            {selection.error && <div role="alert" className="space-y-4 rounded-xl border p-5"><p className="text-sm">{selection.error}</p><Button variant="outline" onClick={() => { setSelection({ kind: selection.kind, year: selection.year }); void fetchForm(selection.kind, selection.year, ++sequence.current); }}>Coba lagi</Button></div>}
            <PanelFormContext.Provider value={formContext}>
              {selection.data?.kind === "account" && <AccountForm />}
              {selection.data?.kind === "loan" && <LoanForm accounts={selection.data.accounts} today={selection.data.today} />}
              {selection.data && selection.data.kind !== "loan" && selection.data.kind !== "account" && <TradeDocumentForm kind={selection.data.kind === "receivable" ? "RECEIVABLE" : "PAYABLE"} accounts={selection.data.accounts} today={selection.data.today} />}
            </PanelFormContext.Provider>
          </div>
        </div>
        {confirmClose && <div className="absolute inset-0 flex items-center justify-center bg-background/90 p-5 backdrop-blur-sm"><section ref={confirmation} role="alert" aria-labelledby="discard-title" className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-lg"><h3 id="discard-title" className="text-lg font-semibold">Tutup formulir?</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Isian yang belum disimpan akan hilang. Anda dapat melanjutkan mengisi terlebih dahulu.</p><div className="mt-6 flex flex-col gap-2"><Button ref={resumeButton} onClick={resume}>Lanjutkan mengisi</Button><Button variant="outline" className="text-destructive" onClick={forceClose}>Tutup & buang isian</Button></div></section></div>}
      </>}
    </dialog>
  </CreationPanelContext.Provider>;
}
