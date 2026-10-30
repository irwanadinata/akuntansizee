import { z } from "zod";
import { rupiah } from "../accounting/money";
import { validBusinessDate } from "../accounting/dates";
export class JournalError extends Error {}
export const businessDate = z.string().refine(validBusinessDate, "Tanggal transaksi tidak sah.");
const amount = z.string().max(40).transform((value, ctx) => {
  try { return rupiah(value); } catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Nominal tidak sah." }); return z.NEVER; }
});
export const journalLineSchema = z.object({
  accountId: z.uuid("Pilih akun yang sah."), debit: amount, credit: amount,
  description: z.string().trim().max(500).default(""),
}).strict().refine(line => (BigInt(line.debit) > 0n && line.credit === "0") || (BigInt(line.credit) > 0n && line.debit === "0"), {
  message: "Setiap baris harus berisi tepat satu debit atau kredit yang positif.", path: ["debit"],
});
export const draftFields = {
  date: businessDate, description: z.string().trim().min(3, "Uraian minimal 3 karakter.").max(2000),
  lines: z.array(journalLineSchema).min(2, "Jurnal minimal dua baris.").max(100, "Maksimal 100 baris per jurnal."),
};
export const createDraftSchema = z.object({ ...draftFields, requestKey: z.uuid() }).strict();
export const editDraftSchema = createDraftSchema.extend({ id: z.uuid(), version: z.number().int().positive() }).strict();
export const targetSchema = z.object({ id: z.uuid(), version: z.number().int().positive(), requestKey: z.uuid() }).strict();
export const reverseSchema = targetSchema.extend({ date: businessDate, reason: z.string().trim().min(3, "Alasan pembatalan wajib diisi.").max(1000) }).strict();
export const yearCreateSchema = z.object({ year: z.number().int().min(1900).max(2199), requestKey: z.uuid() }).strict();
export const yearStatusSchema = targetSchema.extend({ status: z.enum(["OPEN", "LOCKED"]), reason: z.string().trim().min(3).max(1000) }).strict();
export type DraftInput = z.output<typeof createDraftSchema>;
export type JournalLineInput = z.output<typeof journalLineSchema>;
export function totals(lines: { debit: string; credit: string }[]) {
  return lines.reduce((sum, line) => ({ debit: sum.debit + BigInt(line.debit), credit: sum.credit + BigInt(line.credit) }), { debit: 0n, credit: 0n });
}
export function assertBalanced(lines: { debit: string; credit: string }[]) {
  const total = totals(lines);
  if (lines.length < 2 || total.debit <= 0n || total.debit !== total.credit) throw new JournalError("Posting ditolak: total debit harus sama persis dengan kredit dan lebih dari nol.");
}

