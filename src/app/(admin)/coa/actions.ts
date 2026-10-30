"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { accountInputSchema, accountTargetSchema, CoaError } from "@/lib/coa/validation";
import { createAccountInTransaction, editAccountInTransaction, deleteAccountInTransaction, setAccountActiveInTransaction } from "@/lib/coa/mutations";

export type CoaActionResult = { ok: boolean; message: string };
function safeError(error: unknown): CoaActionResult {
  if (error instanceof CoaError) return { ok: false, message: error.message };
  if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Input akun tidak sah." };
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
  if (code === "P2002") return { ok: false, message: "Kode akun sudah digunakan. Gunakan kode lain; akun lama tidak diubah." };
  if (code === "P2003") return { ok: false, message: "Akun memiliki riwayat/relasi dan tidak dapat dihapus. Pilih Nonaktifkan." };
  if (code === "P2034" || code === "P2025") return { ok: false, message: "Akun sedang berubah. Muat ulang dan coba kembali." };
  return { ok: false, message: "Perubahan akun belum dapat disimpan. Tidak ada perubahan sebagian. Hubungi pengelola aplikasi." };
}
export async function saveAccountAction(payload: unknown): Promise<CoaActionResult> {
  const admin = await requireAdmin();
  try {
    assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
    const data = z.object({ target: accountTargetSchema.nullable(), account: accountInputSchema }).strict().parse(payload);
    await getPrisma().$transaction(async tx => {
      if (data.target) await editAccountInTransaction(tx, admin.id, data.target.id, data.target.version, data.account);
      else await createAccountInTransaction(tx, admin.id, data.account);
    });
    revalidatePath("/coa");
    if (data.target) revalidatePath("/coa/" + data.target.id);
    return { ok: true, message: data.target ? "Perubahan akun berhasil disimpan." : "Akun berhasil ditambahkan." };
  } catch (error) { return safeError(error); }
}
export async function changeAccountAction(payload: unknown): Promise<CoaActionResult> {
  const admin = await requireAdmin();
  try {
    assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
    const data = accountTargetSchema.extend({ operation: z.enum(["archive", "activate", "delete"]), confirmation: z.string() }).strict().parse(payload);
    await getPrisma().$transaction(async tx => {
      if (data.operation === "delete") await deleteAccountInTransaction(tx, admin.id, data.id, data.version, data.confirmation);
      else await setAccountActiveInTransaction(tx, admin.id, data.id, data.version, data.operation === "activate");
    });
    revalidatePath("/coa"); revalidatePath("/coa/" + data.id);
    return { ok: true, message: data.operation === "delete" ? "Akun yang belum digunakan berhasil dihapus." : data.operation === "archive" ? "Akun dinonaktifkan. Riwayat tetap tersimpan." : "Akun diaktifkan." };
  } catch (error) { return safeError(error); }
}

