import { z } from "zod";
import { classificationSchema } from "./catalog";

export const accountInputSchema = classificationSchema.safeExtend({
  code: z.string().trim().min(1, "Kode wajib diisi.").max(32).regex(/^[0-9]+(?:\.[0-9]+)*$/, "Gunakan kode angka bertitik sebagai teks."),
  name: z.string().trim().min(1, "Nama wajib diisi.").max(255),
  description: z.string().trim().max(2000),
  isActive: z.boolean(), requiresReview: z.boolean(), reviewConfirmed: z.boolean(),
  reviewReason: z.string().trim().max(1000),
}).strict().superRefine((value, ctx) => {
  if (mustReview(value) && value.isActive && !value.reviewConfirmed) {
    ctx.addIssue({ code: "custom", path: ["reviewConfirmed"], message: "Periksa klasifikasi dan centang persetujuan, atau simpan akun sebagai nonaktif." });
  }
});
export type AccountInput = z.infer<typeof accountInputSchema>;
export function mustReview(value: { requiresReview: boolean; isContra: boolean; isControlAccount: boolean; normalBalance: string; mainType: string; name: string }) {
  const usual = ["ASSET", "COGS", "EXPENSE"].includes(value.mainType) ? "DEBIT" : "CREDIT";
  return value.requiresReview || value.isContra || value.isControlAccount || value.normalBalance !== usual ||
    /gain.?loss|exchange|selisih\s*kurs|pelepasan\s*aset|cadangan kerugian|akumulasi penyusutan|retur pendapatan|discount|deviden|dividen|transitory/i.test(value.name);
}
export const accountTargetSchema = z.object({ id: z.uuid(), version: z.number().int().positive() }).strict();
export class CoaError extends Error {}
export function assertCanDelete(account: { usedAt: Date | null; usageCount: number }) {
  if (account.usedAt || account.usageCount > 0) throw new CoaError("Akun pernah digunakan dan tidak dapat dihapus. Pilih Nonaktifkan.");
}
export function assertCanEdit(current: { usedAt: Date | null; usageCount: number; code: string; mainType: string; reportGroup: string; normalBalance: string; isContra: boolean; isControlAccount: boolean }, input: AccountInput) {
  if (current.usedAt || current.usageCount > 0) {
    for (const field of ["code", "mainType", "reportGroup", "normalBalance", "isContra", "isControlAccount"] as const) {
      if (current[field] !== input[field]) throw new CoaError("Kode dan klasifikasi akun yang pernah digunakan dikunci untuk menjaga histori.");
    }
  }
}

