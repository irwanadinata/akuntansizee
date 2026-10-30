import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin-shell";
import { CreationPanelProvider } from "@/components/transactions/creation-panel";
import { NavigationProvider } from "@/components/loading/navigation-provider";
import { requireAdmin } from "@/lib/auth/session";
import { fiscalContext } from "@/lib/fiscal/context";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  const fiscal=await fiscalContext();
  return <NavigationProvider><AdminShell adminEmail={admin.email} years={fiscal.years} defaultYear={fiscal.defaultYear} preferredYear={fiscal.preferredYear}><CreationPanelProvider>{children}</CreationPanelProvider></AdminShell></NavigationProvider>;
}
