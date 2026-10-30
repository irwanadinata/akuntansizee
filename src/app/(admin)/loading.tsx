import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return <section data-page-loading aria-busy="true" className="space-y-6">
    <div role="status" className="flex items-center gap-3 text-sm font-medium"><LoaderCircle className="size-5 animate-spin text-primary" aria-hidden="true" />Memuat halaman, mohon tunggu…</div>
    <div aria-hidden="true" className="space-y-6 animate-pulse"><div className="h-8 w-56 max-w-full rounded-lg bg-border/70"/><div className="grid gap-4 sm:grid-cols-3">{[0,1,2].map(item=><div key={item} className="h-24 rounded-xl border bg-card"/>)}</div><div className="space-y-4 rounded-xl border bg-card p-5">{[0,1,2,3].map(item=><div key={item} className="h-10 rounded-lg bg-muted"/>)}</div></div>
  </section>;
}
