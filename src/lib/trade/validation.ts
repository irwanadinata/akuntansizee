import { z } from "zod";
import { businessDate } from "../journal/validation";
import { positiveRupiah } from "../loans/validation";
export const tradeKinds = ["RECEIVABLE", "PAYABLE"] as const;
export type TradeKind = typeof tradeKinds[number];
export class TradeError extends Error {}
export const TRADE_CONTROL_CODES = { RECEIVABLE: "1121.1", PAYABLE: "2110.1" } as const;
export const TRADE_PREFIXES = { RECEIVABLE: { document: "PIU", payment: "BYC" }, PAYABLE: { document: "UTG", payment: "BYS" } } as const;
export type TradePrefix = "PIU" | "UTG" | "BYC" | "BYS";
export function documentFields(kind: TradeKind) {
  return z.object({
    partyName: z.string().trim().min(1, kind === "RECEIVABLE" ? "Nama customer wajib diisi." : "Nama supplier wajib diisi.").max(200),
    date: businessDate, dueDate: businessDate.or(z.literal("")).default(""), amount: positiveRupiah,
    counterAccountId: z.uuid(kind === "RECEIVABLE" ? "Pilih akun pendapatan." : "Pilih akun Beban, HPP atau Aset."),
    externalReference: z.string().trim().max(100).default(""), notes: z.string().trim().max(1000).default(""),
  }).strict().refine(value => !value.dueDate || value.dueDate >= value.date, { path: ["dueDate"], message: "Jatuh tempo tidak boleh mendahului tanggal tagihan." });
}
export function createDocumentSchema(kind: TradeKind) { return documentFields(kind).safeExtend({ requestKey: z.uuid() }); }
export const paymentFields = z.object({ date: businessDate, amount: positiveRupiah, cashAccountId: z.uuid("Pilih Kas/Bank yang sah."), notes: z.string().trim().max(1000).default("") }).strict();
export const createPaymentSchema = paymentFields.extend({ documentId: z.uuid(), requestKey: z.uuid() });
export const reverseTradeSchema = z.object({ id: z.uuid(), date: businessDate, reason: z.string().trim().min(3, "Alasan pembatalan wajib diisi.").max(1000), requestKey: z.uuid() }).strict();
export function counterAccountAllowed(kind: TradeKind, account: { mainType: string; reportGroup: string; normalBalance: string; isContra: boolean; isControlAccount: boolean }) {
  if (account.isContra || account.isControlAccount) return false;
  if (kind === "RECEIVABLE") return account.mainType === "REVENUE" && account.normalBalance === "CREDIT";
  return ["EXPENSE", "COGS", "ASSET"].includes(account.mainType) && account.normalBalance === "DEBIT" && account.reportGroup !== "CASH_BANK";
}
