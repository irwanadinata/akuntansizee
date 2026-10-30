"use client";

import { useRef, useState, useTransition } from "react";
import { tradeAction } from "@/app/(admin)/trade-actions";
import type { TradeKind } from "@/lib/trade/validation";

type TradeOperation = "CREATE_DOCUMENT" | "CREATE_PAYMENT" | "REVERSE_DOCUMENT" | "REVERSE_PAYMENT";
type TradeResult = NonNullable<Awaited<ReturnType<typeof tradeAction>>["result"]>;

export function useTradeSubmission(kind: TradeKind, operation: TradeOperation, afterSuccess?: () => void) {
  const request = useRef({ fingerprint: "", key: "" });
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<TradeResult | null>(null);

  function submit(payload: Record<string, string>) {
    if (busy.current || saved) return;
    const fingerprint = JSON.stringify(payload);
    if (request.current.fingerprint !== fingerprint) {
      request.current = { fingerprint, key: crypto.randomUUID() };
    }
    busy.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        const response = await tradeAction(kind, operation, { ...payload, requestKey: request.current.key });
        setMessage(response.message);
        if (response.ok && response.result) {
          setSaved(response.result);
          afterSuccess?.();
        }
      } catch {
        setMessage("Koneksi terputus. Tekan Simpan lagi dengan isian yang sama; transaksi yang sama aman untuk diulang.");
      } finally {
        busy.current = false;
      }
    });
  }

  return { submit, pending, message, saved, clearMessage: () => setMessage("") };
}
