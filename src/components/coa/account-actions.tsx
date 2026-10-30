"use client";
import { useState, useTransition } from "react";
import Link from "@/components/year-link";
import { useRouter } from "next/navigation";
import { changeAccountAction } from "@/app/(admin)/coa/actions";
import { Button } from "@/components/ui/button";

export function AccountActions({ id, version, code, active, canDelete }: { id: string; version: number; code: string; active: boolean; canDelete: boolean }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [operation, setOperation] = useState("");
  const router = useRouter();
  function run(operation: "archive" | "activate" | "delete") {
    const question = operation === "delete" ? "Hapus akun " + code + "? Hanya akun yang belum pernah digunakan dapat dihapus."
      : operation === "archive" ? "Nonaktifkan akun " + code + "? Riwayat tetap tersimpan." : "Aktifkan kembali akun " + code + "?";
    if (!window.confirm(question)) return;
    setOperation(operation);
    startTransition(async () => {
      try {
      const result = await changeAccountAction({ id, version, operation, confirmation: code });
      setMessage(result.message);
      if (result.ok) router.refresh();
      } catch { setMessage("Perubahan akun belum dapat disimpan. Periksa koneksi lalu coba lagi."); }
    });
  }
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-1">
      <Button asChild size="sm" variant="outline"><Link href={"/coa/" + id}>Ubah</Link></Button>
      <Button size="sm" variant="ghost" loading={pending && operation !== "delete"} loadingText="Menyimpan…" disabled={pending} onClick={() => run(active ? "archive" : "activate")}>{active ? "Nonaktifkan" : "Aktifkan"}</Button>
      <Button size="sm" variant="ghost" loading={pending && operation === "delete"} loadingText="Menghapus…" className="text-destructive" disabled={pending || !canDelete} title={canDelete ? "Hapus akun yang belum pernah digunakan" : "Akun pernah digunakan; nonaktifkan untuk menjaga histori"} onClick={() => run("delete")}>Hapus</Button>
    </div>
    {message && <p role="status" className="max-w-xs text-sm">{message}</p>}
    {!canDelete && <p className="text-sm text-muted-foreground">Riwayat pemakaian dilindungi</p>}
  </div>;
}

