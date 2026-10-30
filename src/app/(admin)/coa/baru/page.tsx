import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { AccountForm } from "@/components/coa/account-form";
export const metadata: Metadata = { title: "Tambah Akun" };
export default async function NewAccountPage() {
  await requireAdmin();
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Tambah akun</h1><p className="mt-2 text-sm text-muted-foreground">Isi identitas dan klasifikasi akun. Tidak ada saldo awal yang dibuat.</p></header><AccountForm /></div>;
}

