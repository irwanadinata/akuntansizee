import { z } from "zod";
import { type PrismaClient } from "../../generated/prisma/client";
import { asDate } from "../accounting/dates";
import { accounts, audit, openYear, reserve, reverseInTransaction, writeLines, type JournalDependencies } from "../journal/engine";
import { boundedCommand, newJournalNumber, newPublicNumber, payloadHash } from "../journal/identity";
import { assertBalanced, type JournalLineInput } from "../journal/validation";
import { loanBalance, type LoanTx } from "./balances";
import { createLoanSchema, createPaymentSchema, reverseLoanSchema, EMPLOYEE_CONTROL_CODE, LoanError } from "./validation";
export type LoanOperation = "CREATE_LOAN" | "CREATE_PAYMENT" | "REVERSE_LOAN" | "REVERSE_PAYMENT";
export type LoanDependencies = JournalDependencies & { publicNumber?: (prefix: "PJM" | "CIC", date: Date) => string };
const resultSchema = z.object({ id: z.uuid(), loanId: z.uuid(), number: z.string(), journalId: z.uuid(), journalNumber: z.string(), reversed: z.boolean() });
export type LoanResult = z.infer<typeof resultSchema>;
async function controlAccount(tx: LoanTx) {
  const control = await tx.account.findUnique({ where: { code: EMPLOYEE_CONTROL_CODE } });
  if (!control || !control.isControlAccount || control.mainType !== "ASSET" || control.reportGroup !== "RECEIVABLE" || control.normalBalance !== "DEBIT" || control.isContra)
    throw new LoanError("COA Piutang Karyawan 1122.1 belum tersedia atau klasifikasinya tidak sesuai mapping sah. Periksa COA; akun tidak dibuat otomatis.");
  return control;
}
async function cashAccount(tx: LoanTx, id: string) {
  const cash = await tx.account.findUnique({ where: { id } });
  if (!cash || cash.reportGroup !== "CASH_BANK" || cash.mainType !== "ASSET" || cash.normalBalance !== "DEBIT" || cash.isContra || cash.isControlAccount)
    throw new LoanError("Pilih akun Kas/Bank yang benar, bukan akun biaya atau akun kontrol.");
  return cash;
}
function publicNumber(prefix: "PJM" | "CIC", deps: LoanDependencies) {
  const value = (deps.publicNumber ?? newPublicNumber)(prefix, (deps.now ?? (() => new Date()))());
  if (!new RegExp("^" + prefix + "-\\d{8}-[A-Z0-9]{12}$").test(value)) throw new LoanError("Format nomor transaksi server tidak sah.");
  return value;
}
async function lockedLoan(tx: LoanTx, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id"=${id}::uuid FOR UPDATE`;
  const loan = await tx.loan.findUnique({ where: { id }, include: { journalEntry: true } });
  if (!loan) throw new LoanError("Pinjaman tidak ditemukan.");
  if (loan.reversalEntryId) throw new LoanError("Pinjaman telah dibatalkan dan tidak menerima perubahan atau cicilan baru.");
  return loan;
}
async function checkTimeline(tx: LoanTx, id: string) {
  const balance = await loanBalance(tx, id);
  if (BigInt(balance.minimum) < 0n || BigInt(balance.remaining) < 0n) throw new LoanError("Tanggal/nominal cicilan membuat sisa historis negatif. Periksa tanggal pembayaran dan pembalik yang sudah dicatat.");
  return balance;
}
async function automatic<T>(tx: LoanTx, actorId: string, input: { date: Date; description: string; controlId: string; lines: JournalLineInput[]; source: "LOAN" | "LOAN_PAYMENT" }, deps: LoanDependencies, link: (entry: { id: string; journalNumber: string }) => Promise<T>) {
  const now = deps.now ?? (() => new Date());
  const year = await openYear(tx, input.date);
  assertBalanced(input.lines); await accounts(tx, input.lines, false, input.controlId);
  const entry = await tx.journalEntry.create({ data: { date: input.date, description: input.description, sourceType: input.source,
    fiscalYearId: year.id, createdById: actorId, journalNumber: await reserve(tx, now, deps.number ?? newJournalNumber) } });
  const linked = await link(entry); // Control lines are legal only after their subledger exists.
  await writeLines(tx, entry.id, input.lines);
  await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", postingStatus: "POSTED", postedAt: now(), postedById: actorId, version: { increment: 1 } } });
  await audit(tx, actorId, entry.id, "POSTED", { source: input.source, journalNumber: entry.journalNumber });
  return { entry, linked };
}
export async function executeLoanCommand(db: PrismaClient, actorId: string, operation: LoanOperation, raw: unknown, deps: LoanDependencies = {}): Promise<LoanResult> {
  const input = operation === "CREATE_LOAN" ? createLoanSchema.parse(raw) : operation === "CREATE_PAYMENT" ? createPaymentSchema.parse(raw) : reverseLoanSchema.parse(raw);
  const fingerprint = payloadHash(input);
  return boundedCommand(() => db.$transaction(async tx => {
    const scope = "LOAN:" + actorId + ":" + operation + ":" + input.requestKey;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))::text`;
    const prior = await tx.loanRequest.findUnique({ where: { actorId_operation_requestKey: { actorId, operation, requestKey: input.requestKey } } });
    if (prior) { if (prior.payloadHash !== fingerprint) throw new LoanError("Kunci permintaan sama membawa isi berbeda. Kirim sebagai tindakan baru."); return resultSchema.parse(prior.result); }
    const result = await work(tx);
    await tx.loanRequest.create({ data: { actorId, operation, requestKey: input.requestKey, payloadHash: fingerprint, result } });
    return result;
  }, { timeout: 30000, maxWait: 10000 }));
  async function work(tx: LoanTx): Promise<LoanResult> {
    if (operation === "CREATE_LOAN") {
      const value = createLoanSchema.parse(raw), control = await controlAccount(tx); await cashAccount(tx, value.cashAccountId);
      const number = publicNumber("PJM", deps);
      const { entry, linked: loan } = await automatic(tx, actorId, { date: asDate(value.date), description: "Pinjaman " + value.employeeName + " · " + number, source: "LOAN", controlId: control.id,
        lines: [{ accountId: control.id, debit: value.amount, credit: "0", description: "Pinjaman karyawan" }, { accountId: value.cashAccountId, debit: "0", credit: value.amount, description: "Uang dikeluarkan" }] }, deps,
      entry => tx.loan.create({ data: { loanNumber: number, employeeName: value.employeeName, date: asDate(value.date), amount: value.amount, dueDate: value.dueDate ? asDate(value.dueDate) : null,
        cashAccountId: value.cashAccountId, controlAccountId: control.id, notes: value.notes || null, journalEntryId: entry.id, createdById: actorId } }));
      await audit(tx, actorId, loan.id, "CREATED", { number, employeeName: loan.employeeName, amount: value.amount, journalId: entry.id }, "LOAN");
      return { id: loan.id, loanId: loan.id, number, journalId: entry.id, journalNumber: entry.journalNumber, reversed: false };
    }
    if (operation === "CREATE_PAYMENT") {
      const value = createPaymentSchema.parse(raw), loan = await lockedLoan(tx, value.loanId);
      const date = asDate(value.date); if (date < loan.date) throw new LoanError("Tanggal cicilan tidak boleh mendahului tanggal pinjaman.");
      const balance = await loanBalance(tx, loan.id);
      if (BigInt(value.amount) > BigInt(balance.remaining)) throw new LoanError("Cicilan melebihi sisa pinjaman. Muat ulang untuk melihat sisa terbaru.");
      await cashAccount(tx, value.cashAccountId);
      const number = publicNumber("CIC", deps);
      const { entry, linked: payment } = await automatic(tx, actorId, { date, description: "Cicilan " + loan.employeeName + " · " + number + " / " + loan.loanNumber, source: "LOAN_PAYMENT", controlId: loan.controlAccountId,
        lines: [{ accountId: value.cashAccountId, debit: value.amount, credit: "0", description: "Cicilan diterima" }, { accountId: loan.controlAccountId, debit: "0", credit: value.amount, description: "Mengurangi pinjaman" }] }, deps,
      entry => tx.loanPayment.create({ data: { loanId: loan.id, paymentNumber: number, date, amount: value.amount, cashAccountId: value.cashAccountId, notes: value.notes || null, journalEntryId: entry.id, createdById: actorId } }));
      await tx.loan.update({ where: { id: loan.id }, data: { version: { increment: 1 } } });
      await checkTimeline(tx, loan.id);
      await audit(tx, actorId, payment.id, "CREATED", { number, loanId: loan.id, amount: value.amount, journalId: entry.id }, "LOAN_PAYMENT");
      return { id: payment.id, loanId: loan.id, number, journalId: entry.id, journalNumber: entry.journalNumber, reversed: false };
    }
    const value = reverseLoanSchema.parse(raw);
    const payment = operation === "REVERSE_PAYMENT" ? await tx.loanPayment.findUnique({ where: { id: value.id } }) : null;
    if (operation === "REVERSE_PAYMENT" && !payment) throw new LoanError("Cicilan tidak ditemukan.");
    const loan = await lockedLoan(tx, payment ? payment.loanId : value.id);
    const target = payment ? await tx.loanPayment.findUniqueOrThrow({ where: { id: payment.id }, include: { journalEntry: true } }) : loan;
    if (target.reversalEntryId) throw new LoanError("Transaksi sudah dibatalkan.");
    const date = asDate(value.date);
    if (!payment) {
      const payments = await tx.loanPayment.findMany({ where: { loanId: loan.id }, include: { reversalEntry: true } });
      if (payments.some(row => !row.reversalEntryId)) throw new LoanError("Batalkan seluruh cicilan aktif terlebih dahulu, kemudian batalkan pinjaman.");
      if (payments.some(row => row.date > date || (row.reversalEntry && row.reversalEntry.date > date))) throw new LoanError("Tanggal pembatalan pinjaman harus pada/setelah seluruh cicilan dan pembaliknya.");
    }
    const reversed = await reverseInTransaction(tx, actorId, { id: target.journalEntryId, version: target.journalEntry.version, date: value.date, reason: value.reason, requestKey: value.requestKey }, deps,
      payment ? "LOAN_PAYMENT" : "LOAN", loan.controlAccountId);
    const data = { reversalEntryId: reversed.id, reversalReason: value.reason, reversedAt: (deps.now ?? (() => new Date()))(), version: { increment: 1 } };
    if (payment) { await tx.loanPayment.update({ where: { id: payment.id }, data }); await tx.loan.update({ where: { id: loan.id }, data: { version: { increment: 1 } } }); }
    else await tx.loan.update({ where: { id: loan.id }, data });
    await checkTimeline(tx, loan.id);
    const number = payment ? payment.paymentNumber : loan.loanNumber;
    await audit(tx, actorId, target.id, "REVERSED", { number, loanId: loan.id, reversalId: reversed.id, reason: value.reason }, payment ? "LOAN_PAYMENT" : "LOAN");
    return { id: target.id, loanId: loan.id, number, journalId: reversed.id, journalNumber: reversed.journalNumber!, reversed: true };
  }
}
