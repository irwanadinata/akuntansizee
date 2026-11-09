import { z } from "zod";
import { journalNumberSchema } from "./validation";
import { loanFields, paymentFields as loanPaymentFields } from "../loans/validation";
import { documentFields, paymentFields as tradePaymentFields, tradeKinds } from "../trade/validation";
const common = { id: z.uuid(), version: z.number().int().positive(), sourceVersion: z.number().int().positive(), journalNumber: journalNumberSchema,
  reason: z.string().trim().min(3, "Tuliskan alasan perubahan, minimal 3 karakter.").max(1000), requestKey: z.uuid() };
export const sourceEditSchema = z.discriminatedUnion("sourceType", [
  loanFields.safeExtend({ ...common, sourceType: z.literal("LOAN") }).strict(),
  loanPaymentFields.extend({ ...common, sourceType: z.literal("LOAN_PAYMENT"), parentVersion: z.number().int().positive() }).strict(),
  documentFields("RECEIVABLE").safeExtend({ ...common, sourceType: z.literal("TRADE_DOCUMENT"), kind: z.enum(tradeKinds) }).strict(),
  tradePaymentFields.extend({ ...common, sourceType: z.literal("TRADE_PAYMENT"), kind: z.enum(tradeKinds), parentVersion: z.number().int().positive() }).strict(),
]);
export type SourceEditInput = z.input<typeof sourceEditSchema>;
export type SourceEditValues = z.output<typeof sourceEditSchema>;
