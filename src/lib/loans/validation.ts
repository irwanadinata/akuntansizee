import { z } from "zod";
import { businessDate } from "../journal/validation";
import { rupiah } from "../accounting/money";
export class LoanError extends Error {}
export const positiveRupiah = z.string().trim().min(1, "Jumlah wajib diisi.").max(40).transform((value, ctx) => {
  try { const amount = rupiah(value); if (BigInt(amount) <= 0n) throw new Error("Jumlah harus lebih dari nol."); return amount; }
  catch (error) { ctx.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Jumlah tidak sah." }); return z.NEVER; }
});
export const loanFields = z.object({ employeeName: z.string().trim().min(2, "Nama karyawan wajib diisi.").max(200), date: businessDate,
  amount: positiveRupiah, cashAccountId: z.uuid("Pilih kas/bank yang sah."), notes: z.string().trim().max(1000).default(""), dueDate: businessDate.or(z.literal("")).default("") }).strict().refine(value => !value.dueDate || value.dueDate >= value.date, { path: ["dueDate"], message: "Jatuh tempo tidak boleh mendahului pinjaman." });
export const paymentFields = z.object({ date: businessDate, amount: positiveRupiah, cashAccountId: z.uuid("Pilih kas/bank penerima."), notes: z.string().trim().max(1000).default("") }).strict();
export const createLoanSchema = loanFields.safeExtend({ requestKey: z.uuid() });
export const createPaymentSchema = paymentFields.extend({ loanId: z.uuid(), requestKey: z.uuid() });
export const reverseLoanSchema = z.object({ id: z.uuid(), date: businessDate, reason: z.string().trim().min(3, "Alasan pembatalan wajib diisi.").max(1000), requestKey: z.uuid() }).strict();
export const EMPLOYEE_CONTROL_CODE = "1122.1";
