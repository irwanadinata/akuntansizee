import { z } from "zod";
import { classificationSchema, type Classification, type MainType, type ReportGroup } from "./catalog";

export const sourceAccountSchema = z.object({
  sourceRow: z.number().int().min(2).max(92), sourceCode: z.string().trim().regex(/^\d{4}\.\d+$/),
  name: z.string().trim().min(1).max(255), sourceType: z.string().trim().min(1),
  details: z.string(),
}).strict();
export type SourceAccount = z.infer<typeof sourceAccountSchema>;
export type ProposedMapping = Classification & { requiresReview: boolean; reviewReason: string | null };

const sourceTypes: Record<string, [MainType, ReportGroup]> = {
  Cash: ["ASSET", "CASH_BANK"], Bank: ["ASSET", "CASH_BANK"],
  "Accounts Receivable": ["ASSET", "RECEIVABLE"], "Current Asset": ["ASSET", "CURRENT_ASSET"],
  "Fixed Asset": ["ASSET", "FIXED_ASSET"], "Other Asset": ["ASSET", "OTHER_ASSET"],
  "Pre-paid Expense": ["ASSET", "PREPAID"], "Accounts Payable": ["LIABILITY", "CURRENT_LIABILITY"],
  "Current Liability": ["LIABILITY", "CURRENT_LIABILITY"], "Long Term Liability": ["LIABILITY", "LONG_TERM_LIABILITY"],
  "Taxes and Remittances": ["LIABILITY", "TAX_PAYABLE"], Equity: ["EQUITY", "CAPITAL"],
  "Retained Earnings": ["EQUITY", "RETAINED_EARNINGS"], Income: ["REVENUE", "OPERATING_REVENUE"],
  "Cost of Goods Sold": ["COGS", "COST_OF_SALES"], Expense: ["EXPENSE", "OPERATING_EXPENSE"],
  "Gain/Loss on Exchange": ["OTHER_RESULT", "OTHER_RESULT"],
};
const controls = new Set(["Piutang Usaha", "Piutang Karyawan", "Hutang Usaha"]);
const otherExpenses = new Set(["Beban Administrasi Bank", "Beban Bunga Hutang Leasing", "Beban Bunga Hutang Usaha"]);
export function proposeMapping(source: SourceAccount): ProposedMapping {
  const pair = sourceTypes[source.sourceType];
  if (!pair) throw new Error("Jenis sumber COA belum memiliki mapping eksplisit: " + source.sourceType);
  const [mainType, reportGroup] = pair;
  const result: ProposedMapping = {
    mainType, reportGroup, normalBalance: ["ASSET", "COGS", "EXPENSE"].includes(mainType) ? "DEBIT" : "CREDIT",
    isContra: false, isControlAccount: controls.has(source.name), requiresReview: false, reviewReason: null,
  };
  if (source.name.startsWith("Akumulasi Penyusutan") || source.name === "Cadangan Kerugian Piutang") {
    Object.assign(result, { mainType: "ASSET", normalBalance: "CREDIT", isContra: true,
      reportGroup: source.name === "Cadangan Kerugian Piutang" ? "RECEIVABLE" : "FIXED_ASSET" });
    result.reviewReason = "Kontra aset: pastikan saldo kredit mengurangi aset pada kelompok yang tepat.";
  } else if (["Discount", "Retur Pendapatan"].includes(source.name)) {
    Object.assign(result, { mainType: "REVENUE", reportGroup: "CONTRA_REVENUE", normalBalance: "DEBIT", isContra: true });
    result.reviewReason = "Kontra pendapatan: mengurangi pendapatan, bukan pendapatan tambahan.";
  } else if (source.name === "Deviden Pemegang Saham") {
    Object.assign(result, { reportGroup: "DIVIDENDS", normalBalance: "DEBIT", isContra: true });
    result.reviewReason = "Distribusi kepada pemegang saham merupakan pengurang ekuitas, bukan beban.";
  } else if (source.sourceType === "Gain/Loss on Exchange") {
    result.reviewReason = "Usulan sementara hasil lain neto. MainType, kelompok dan tanda laba/rugi kurs wajib disahkan; tidak ada valuta otomatis.";
  } else if (source.name === "Transitory Account") {
    result.reviewReason = "Akun pemindahan: tinjau penyajian kas/bank; tidak boleh menjadi akun penyeimbang.";
  } else if (source.name === "Pendapatan Penjualan Aktiva") {
    result.mainType = "OTHER_RESULT";
    result.reportGroup = "OTHER_RESULT";
    result.reviewReason = "Tinjau hasil pelepasan aset; penerimaan bukan otomatis laba sebesar penerimaan.";
  } else if (["Pendapatan Jasa Giro", "Pendapatan Lain-Lain"].includes(source.name)) {
    result.reportGroup = "OTHER_INCOME";
  } else if (otherExpenses.has(source.name)) {
    result.reportGroup = "OTHER_EXPENSE";
  }
  if (source.name === "Piutang Karyawan") result.reportGroup = "RECEIVABLE";
  if (result.isControlAccount) result.reviewReason = "Sahkan akun kontrol dan hubungannya dengan rincian transaksi sebelum digunakan.";
  result.requiresReview = result.reviewReason !== null;
  classificationSchema.parse({
    mainType: result.mainType, reportGroup: result.reportGroup, normalBalance: result.normalBalance,
    isContra: result.isContra, isControlAccount: result.isControlAccount,
  });
  return result;
}

