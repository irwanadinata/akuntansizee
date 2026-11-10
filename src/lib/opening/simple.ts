import { z } from "zod";
import type { Classification } from "../coa/catalog";
import { JournalError } from "../journal/validation";
import { assertOpeningAccount, openingFields, openingLineSchema } from "./validation";

export type OpeningAccount = Omit<Classification, "reportGroup"> & {
  id: string;
  code: string;
  name: string;
  reportGroup: string;
};

export function isOpeningCash(account: OpeningAccount) {
  return account.mainType === "ASSET" && account.reportGroup === "CASH_BANK"
    && account.normalBalance === "DEBIT" && !account.isContra && !account.isControlAccount;
}

export function isOpeningCapital(account: OpeningAccount) {
  return account.mainType === "EQUITY" && account.reportGroup === "CAPITAL"
    && account.normalBalance === "CREDIT" && !account.isContra && !account.isControlAccount;
}

export const simpleOpeningFields = z.object({
  fiscalYearId: openingFields.shape.fiscalYearId,
  cutoverDate: openingFields.shape.cutoverDate,
  cashAccountId: z.uuid("Pilih akun kas/bank di pengaturan."),
  capitalAccountId: z.uuid("Pilih akun modal pemilik di pengaturan."),
  amount: openingLineSchema.shape.amount,
  verificationNote: z.string().trim().max(1000).refine(value => !value || value.length >= 10, "Catatan minimal 10 karakter, atau kosongkan.").default(""),
}).strict();

type VerifiedAccount = OpeningAccount & { isActive: boolean; reviewedAt: Date | null };

export function simpleOpeningInput(raw: unknown, rows: VerifiedAccount[]) {
  const input = simpleOpeningFields.parse(raw);
  const cash = rows.find(account => account.id === input.cashAccountId);
  const capital = rows.find(account => account.id === input.capitalAccountId);
  if (!cash || !isOpeningCash(cash)) throw new JournalError("Pilih akun kas/bank yang sah untuk saldo awal.");
  if (!capital || !isOpeningCapital(capital)) throw new JournalError("Pilih akun modal pemilik yang sah untuk saldo awal.");
  assertOpeningAccount(cash);
  assertOpeningAccount(capital);
  return openingFields.parse({
    fiscalYearId: input.fiscalYearId,
    cutoverDate: input.cutoverDate,
    verificationNote: input.verificationNote || "Saldo kas/bank awal dari modal pemilik; nominal dan tanggal dikonfirmasi admin.",
    lines: [
      { accountId: cash.id, side: "DEBIT", amount: input.amount },
      { accountId: capital.id, side: "CREDIT", amount: input.amount },
    ],
  });
}
