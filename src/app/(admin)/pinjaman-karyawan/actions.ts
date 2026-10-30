"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { LoanError } from "@/lib/loans/validation";
import { JournalError } from "@/lib/journal/validation";
import { executeLoanCommand, type LoanResult } from "@/lib/loans/engine";
export type LoanActionResult = { ok: boolean; message: string; result?: LoanResult };
export async function loanAction(operation: unknown, payload: unknown): Promise<LoanActionResult> {
  const admin = await requireAdmin();
  try {
    assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
    const action = z.enum(["CREATE_LOAN", "CREATE_PAYMENT", "REVERSE_LOAN", "REVERSE_PAYMENT"]).parse(operation);
    const result = await executeLoanCommand(getPrisma(), admin.id, action, payload);
    for (const path of ["/pinjaman-karyawan", "/jurnal", "/buku-besar", "/coa"]) revalidatePath(path);
    revalidatePath("/pinjaman-karyawan/[id]", "page"); revalidatePath("/jurnal/[id]", "page");
    return { ok:true, message: result.reversed ? "Pembatalan berhasil dicatat — Jurnal " + result.journalNumber : (action === "CREATE_LOAN" ? "Pinjaman" : "Cicilan") + " berhasil dicatat — Nomor " + result.number, result };
  } catch (error) {
    if (error instanceof LoanError || error instanceof JournalError) return { ok:false,message:error.message };
    if (error instanceof z.ZodError) return { ok:false,message:error.issues[0]?.message ?? "Input tidak sah." };
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "P2002" || code === "P2034" || code === "P2025") return { ok:false,message:"Transaksi sedang berubah atau nomor bentrok. Muat ulang atau ulangi permintaan yang sama." };
    return { ok:false,message:"Transaksi belum dapat disimpan. Pinjaman/cicilan dan jurnal tidak disimpan sebagian. Ulangi permintaan yang sama atau hubungi pengelola." };
  }
}
