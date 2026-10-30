"use client";

import { forwardRef, useContext, type ComponentProps } from "react";
import Link from "@/components/year-link";
import { Button } from "@/components/ui/button";
import { creationOptions, type CreationKind } from "@/lib/transactions/creation";
import { CreationPanelContext, PanelFormContext } from "./panel-context";

type CreationLinkProps = Omit<ComponentProps<typeof Link>, "href"> & { kind: CreationKind };

export const CreationLink = forwardRef<HTMLAnchorElement, CreationLinkProps>(function CreationLink({ kind, onClick, ...props }, ref) {
  const panel = useContext(CreationPanelContext);
  return <Link {...props} ref={ref} href={creationOptions[kind].href} aria-haspopup={panel ? "dialog" : undefined} onClick={event => {
    onClick?.(event);
    if (!panel || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); panel.open(kind);
  }} />;
});

export function CreationCancel({ href }: { href: string }) {
  const panel = useContext(PanelFormContext);
  return panel ? <Button variant="outline" onClick={panel.dismiss}>Batal</Button> : <Button asChild variant="outline"><Link href={href}>Batal</Link></Button>;
}
