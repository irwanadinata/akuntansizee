import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { findAccount } from "@/lib/coa/queries";
import { AccountForm } from "@/components/coa/account-form";
import { accountInputSchema } from "@/lib/coa/validation";
export const metadata: Metadata = { title: "Ubah Akun" };
export default async function EditAccountPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const account = await findAccount((await params).id);
  if (!account) notFound();
  const input = accountInputSchema.parse({
    code: account.code, name: account.name, description: account.description ?? "", mainType: account.mainType,
    reportGroup: account.reportGroup, normalBalance: account.normalBalance, isContra: account.isContra,
    isControlAccount: account.isControlAccount, isActive: account.isActive, requiresReview: account.requiresReview,
    reviewReason: account.reviewReason ?? "", reviewConfirmed: Boolean(account.reviewedAt),
  });
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Ubah akun</h1><p className="mt-2 text-sm text-muted-foreground">Perubahan tidak mengisi atau menyesuaikan saldo akun.</p>{account.sourceRow && <p className="mt-2 text-sm text-muted-foreground">Sumber COA: baris {account.sourceRow}, kode asli {account.sourceCode}. Identitas sumber dipertahankan.</p>}</header>
    <AccountForm initial={{ ...input, reviewConfirmed: false, id: account.id, version: account.version, used: Boolean(account.usedAt || account._count.usageRecords) }} />
  </div>;
}

