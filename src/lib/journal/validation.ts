import { z } from "zod";
import { rupiah } from "../accounting/money";
import { validBusinessDate } from "../accounting/dates";
export class JournalError extends Error {}
export const journalOperations = ["CREATE", "UPDATE", "DELETE", "CREATE_YEAR", "SET_YEAR_STATUS"] as const;
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
export const journalNumberSchema = z.string().trim().min(1, "Nomor jurnal wajib diisi.").max(40, "Nomor jurnal maksimal 40 karakter.").regex(/^[A-Za-z0-9][A-Za-z0-9./_-]*$/, "Gunakan huruf, angka, titik, garis miring, tanda hubung atau garis bawah.").transform(value => value.toUpperCase());
export const optionalJournalNumber = journalNumberSchema.or(z.literal("")).optional();
export const journalFields = {
  journalNumber: journalNumberSchema,
  date: businessDate, description: z.string().trim().min(3, "Uraian minimal 3 karakter.").max(2000),
  lines: z.array(journalLineSchema).min(2, "Jurnal minimal dua baris.").max(100, "Maksimal 100 baris per jurnal."),
};
export const createJournalSchema = z.object({ ...journalFields, requestKey: z.uuid() }).strict().superRefine((value, ctx) => {
  try { assertBalanced(value.lines); } catch (error) { ctx.addIssue({ code: "custom", path: ["lines"], message: (error as Error).message }); }
});
export const editJournalSchema = createJournalSchema.safeExtend({ id: z.uuid(), version: z.number().int().positive(), reason: z.string().trim().min(3, "Tuliskan alasan perubahan, minimal 3 karakter.").max(1000) }).strict();
// Only the service's stored per-account opening marker can authorize this shape.
export const editOpeningJournalSchema = z.object({ ...journalFields,
  lines: z.array(journalLineSchema).min(1, "Isi minimal satu COA.").max(100),
  id: z.uuid(), version: z.number().int().positive(), requestKey: z.uuid(),
  reason: z.string().trim().min(3, "Tuliskan alasan perubahan, minimal 3 karakter.").max(1000),
}).strict();
export const targetSchema = z.object({ id: z.uuid(), version: z.number().int().positive(), requestKey: z.uuid() }).strict();
export const deleteJournalSchema = targetSchema.extend({ reason: z.string().trim().min(3, "Tuliskan alasan penghapusan, minimal 3 karakter.").max(1000) }).strict();
export const yearCreateSchema = z.object({ year: z.number().int().min(1900).max(2199), requestKey: z.uuid() }).strict();
export const yearStatusSchema = targetSchema.extend({ status: z.enum(["OPEN", "LOCKED"]), reason: z.string().trim().min(3).max(1000) }).strict();
export type JournalInput = z.output<typeof createJournalSchema>;
export type JournalLineInput = z.output<typeof journalLineSchema>;
export function totals(lines: { debit: string; credit: string }[]) {
  return lines.reduce((sum, line) => ({ debit: sum.debit + BigInt(line.debit), credit: sum.credit + BigInt(line.credit) }), { debit: 0n, credit: 0n });
}
export function assertBalanced(lines: { debit: string; credit: string }[]) {
  const total = totals(lines);
  if (lines.length < 2 || total.debit <= 0n || total.debit !== total.credit) throw new JournalError("Posting ditolak: total debit harus sama persis dengan kredit dan lebih dari nol.");
}

