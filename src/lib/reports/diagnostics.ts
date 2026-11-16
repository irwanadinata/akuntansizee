import { formatRupiah } from "../accounting/money";
import type { FinancialReport } from "./engine";

const openingTitle = "Saldo awal belum seimbang";
const openingDescription = "Saldo awal yang sudah diisi telah tercatat. Periksa atau lengkapi saldo awal aset, utang, dan ekuitas (modal serta saldo laba) dari pembukuan lama agar neraca seimbang.";
export const OPENING_BALANCE_WARNING = openingTitle + ". " + openingDescription;
export const BALANCE_WARNING = "Neraca belum seimbang. Periksa saldo awal, klasifikasi akun, dan jurnal sesuai pembukuan.";

export function balanceWarnings(openingDifference: string, balanceDifference: string) {
  const warnings: string[] = [];
  if (openingDifference !== "0") warnings.push(OPENING_BALANCE_WARNING);
  // An opening balance already explains this difference; keep other discrepancies visible.
  if (balanceDifference !== "0" && balanceDifference !== openingDifference) warnings.push(BALANCE_WARNING);
  return warnings;
}

export function reportNotices(report: Pick<FinancialReport, "diagnostics" | "balance">) {
  const notices: { kind: "opening" | "review"; title: string; status: string; paragraphs: string[] }[] = [];
  const difference = "Selisih neraca: " + formatRupiah(report.balance.difference);
  if (report.diagnostics.openingDifference !== "0") {
    notices.push({ kind: "opening", title: openingTitle, status: "Belum final", paragraphs: [openingDescription, difference] });
  }
  const warnings = report.diagnostics.warnings.filter(warning => warning !== OPENING_BALANCE_WARNING);
  if (warnings.length) {
    notices.push({ kind: "review", title: "Laporan perlu diperiksa", status: "Belum final", paragraphs: warnings });
  }
  return notices;
}
