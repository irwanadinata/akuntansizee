"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { executeJournalCommand, type CommandResult } from "@/lib/journal/engine";
import { JournalError } from "@/lib/journal/validation";
export type JournalActionResult = { ok: boolean; message: string; result?: CommandResult };
export async function journalAction(operation: unknown, payload: unknown): Promise<JournalActionResult> {
  const admin = await requireAdmin();
  try {
    assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
    const action = z.enum(["CREATE_DRAFT", "EDIT_DRAFT", "POST", "REVERSE", "DELETE_DRAFT", "CREATE_YEAR", "SET_YEAR_STATUS"]).parse(operation);
    const result = await executeJournalCommand(getPrisma(), admin.id, action, payload);
    for (const path of ["/jurnal", "/buku-besar", "/tahun-buku", "/coa"]) revalidatePath(path);
    revalidatePath("/jurnal/[id]", "page");
    return { ok: true, message: result.journalNumber ? "Berhasil disimpan — Nomor Jurnal " + result.journalNumber : "Tindakan berhasil disimpan.", result };
  } catch (error) {
    if (error instanceof JournalError) return { ok: false, message: error.message };
    if (error instanceof z.ZodError) return { ok: false, message: error.issues[0]?.message ?? "Input tidak sah." };
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "P2002") return { ok: false, message: "Nomor atau tahun buku sudah digunakan. Muat ulang dan coba kembali." };
    if (code === "P2025" || code === "P2034") return { ok: false, message: "Data sedang berubah. Muat ulang sebelum melanjutkan." };
    return { ok: false, message: "Tindakan ditolak atau koneksi belum tersedia. Tidak ada perubahan sebagian. Coba ulang permintaan yang sama." };
  }
}
