"use client";

import { createContext, useContext, useEffect } from "react";
import type { CreationKind } from "@/lib/transactions/creation";

export type PanelFormState = { dirty: boolean; pending: boolean; saved: boolean };
export const CreationPanelContext = createContext<{ open: (kind: CreationKind) => void } | null>(null);
export const PanelFormContext = createContext<{ dismiss: () => void; report: (state: PanelFormState) => void } | null>(null);

export function usePanelForm(state: PanelFormState) {
  const context = useContext(PanelFormContext);
  const report = context?.report;
  useEffect(() => { report?.({ dirty: state.dirty, pending: state.pending, saved: state.saved }); }, [report, state.dirty, state.pending, state.saved]);
  return context;
}
