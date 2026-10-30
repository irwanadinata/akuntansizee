"use client";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

export function FilterContent({children,actions,columns,title}:{children:ReactNode;actions:ReactNode;columns:number;title:string}) {
  const { pending } = useFormStatus();
  return <div aria-busy={pending} data-filter-pending={pending || undefined}>
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3.5 text-sm font-semibold"><span className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" aria-hidden="true"/>{title}</span><span role="status" className="inline-flex items-center gap-1.5 text-xs font-normal text-muted-foreground">{pending&&<><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true"/>Memuat…</>}</span></div>
    <fieldset disabled={pending} onClickCapture={event=>{if(pending){event.preventDefault();event.stopPropagation();}}} className="filter-bar-fields min-w-0 p-5" data-columns={columns}>{children}<div className="filter-bar-actions flex min-w-0 items-center justify-end gap-2">{actions}</div></fieldset>
  </div>;
}

export function FilterSubmitButton({children,className,...props}:ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();
  return <Button {...props} type="submit" disabled={pending || props.disabled} aria-busy={pending} data-loading={pending || undefined} className={"relative " + (className ?? "")}><span className={"inline-flex items-center gap-2 " + (pending ? "invisible" : "")}>{children}</span>{pending&&<span className="absolute inset-0 flex items-center justify-center"><LoaderCircle className="size-4 animate-spin" aria-hidden="true"/><span className="sr-only">Memuat hasil filter…</span></span>}</Button>;
}
