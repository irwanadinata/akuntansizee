import { z } from "zod";

export const mainTypes = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "COGS", "EXPENSE", "OTHER_RESULT"] as const;
export const normalBalances = ["DEBIT", "CREDIT"] as const;
export const typeLabels: Record<MainType, string> = {
  ASSET: "Aset", LIABILITY: "Kewajiban", EQUITY: "Ekuitas",
  REVENUE: "Pendapatan", COGS: "HPP", EXPENSE: "Beban", OTHER_RESULT: "Keuntungan/Kerugian Lainnya",
};
export const groupDefinitions = {
  CASH_BANK: ["Kas & Bank", "ASSET"], RECEIVABLE: ["Piutang", "ASSET"],
  CURRENT_ASSET: ["Aset Lancar Lainnya", "ASSET"], PREPAID: ["Biaya/Pajak Dibayar di Muka", "ASSET"],
  FIXED_ASSET: ["Aset Tetap", "ASSET"], OTHER_ASSET: ["Aset Lainnya", "ASSET"],
  CURRENT_LIABILITY: ["Kewajiban Jangka Pendek", "LIABILITY"],
  LONG_TERM_LIABILITY: ["Kewajiban Jangka Panjang", "LIABILITY"],
  TAX_PAYABLE: ["Utang Pajak", "LIABILITY"], CAPITAL: ["Modal", "EQUITY"],
  RETAINED_EARNINGS: ["Laba Ditahan", "EQUITY"], DIVIDENDS: ["Pengurang Ekuitas", "EQUITY"],
  OPERATING_REVENUE: ["Pendapatan Usaha", "REVENUE"], CONTRA_REVENUE: ["Pengurang Pendapatan", "REVENUE"],
  OTHER_INCOME: ["Pendapatan Lainnya", "REVENUE"], OTHER_RESULT: ["Hasil Lainnya Neto", "OTHER_RESULT"],
  COST_OF_SALES: ["Harga Pokok Pendapatan", "COGS"], OPERATING_EXPENSE: ["Beban Usaha", "EXPENSE"],
  OTHER_EXPENSE: ["Beban Lainnya", "EXPENSE"],
  INCOME_TAX_EXPENSE: ["Beban Pajak Penghasilan", "EXPENSE"],
} as const;
export const reportGroups = Object.keys(groupDefinitions) as [ReportGroup, ...ReportGroup[]];
export type MainType = typeof mainTypes[number];
export type ReportGroup = keyof typeof groupDefinitions;
export const classificationSchema = z.object({
  mainType: z.enum(mainTypes), reportGroup: z.enum(reportGroups),
  normalBalance: z.enum(normalBalances), isContra: z.boolean(), isControlAccount: z.boolean(),
}).strict().refine(value => groupDefinitions[value.reportGroup][1] === value.mainType, {
  message: "Kelompok laporan harus sesuai jenis akun.", path: ["reportGroup"],
}).superRefine((value, ctx) => {
  const usual = ["ASSET", "COGS", "EXPENSE"].includes(value.mainType) ? "DEBIT" : "CREDIT";
  const expected = value.isContra ? (usual === "DEBIT" ? "CREDIT" : "DEBIT") : usual;
  if (value.normalBalance !== expected) ctx.addIssue({ code: "custom", path: ["normalBalance"], message: "Saldo normal bertentangan dengan jenis dan sifat kontra akun." });
  if (value.isControlAccount && value.isContra) ctx.addIssue({ code: "custom", path: ["isControlAccount"], message: "Akun kontrol tidak boleh sekaligus menjadi kontra akun." });
  if (["CONTRA_REVENUE", "DIVIDENDS"].includes(value.reportGroup) && !value.isContra) ctx.addIssue({ code: "custom", path: ["isContra"], message: "Kelompok pengurang wajib ditandai sebagai kontra akun." });
});
export type Classification = z.infer<typeof classificationSchema>;
export function groupLabel(group: string) {
  return groupDefinitions[group as ReportGroup]?.[0] ?? group;
}

