// Historical data fixture only. Production commands cannot create reversing journals.
import type { PrismaClient } from "../../src/generated/prisma/client";
import { asDate } from "../../src/lib/accounting/dates";
import { audit, openYear, reserve, writeLines } from "../../src/lib/journal/engine";
import { newJournalNumber } from "../../src/lib/journal/identity";

export async function seedLegacyReversal(db: PrismaClient, actorId: string, journalId: string, effectiveDate: string) {
  return db.$transaction(async tx => {
    const original = await tx.journalEntry.findUniqueOrThrow({ where: { id: journalId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    const date = asDate(effectiveDate), now = new Date(), reason = "Riwayat sebelum fitur jurnal pembalik dihapus";
    const fiscal = await openYear(tx, date);
    const reversal = await tx.journalEntry.create({ data: { journalNumber: await reserve(tx, () => now, newJournalNumber), date,
      description: reason, fiscalYearId: fiscal.id, sourceType: "REVERSAL", reverseOfId: original.id, reversalReason: reason, createdById: actorId } });
    await writeLines(tx, reversal.id, original.lines.map(line => ({ accountId: line.accountId, debit: line.credit.toFixed(0), credit: line.debit.toFixed(0), description: line.description ?? "" })));
    await tx.journalEntry.update({ where: { id: reversal.id }, data: { status: "POSTED", postingStatus: "POSTED", postedAt: now, postedById: actorId, version: { increment: 1 } } });
    await tx.journalEntry.update({ where: { id: original.id }, data: { status: "REVERSED", reversedAt: now, reversedById: actorId, reversalReason: reason, version: { increment: 1 } } });
    const data = { reversalEntryId: reversal.id, reversalReason: reason, reversedAt: now, version: { increment: 1 } };
    if (original.sourceType === "LOAN") { const row=await tx.loan.update({ where: { journalEntryId: original.id }, data }); await audit(tx,actorId,row.id,"REVERSED",{},"LOAN"); }
    if (original.sourceType === "LOAN_PAYMENT") { const row=await tx.loanPayment.update({ where: { journalEntryId: original.id }, data }); await audit(tx,actorId,row.id,"REVERSED",{},"LOAN_PAYMENT"); }
    if (original.sourceType === "TRADE_DOCUMENT") { const row=await tx.tradeDocument.update({ where: { journalEntryId: original.id }, data }); await audit(tx,actorId,row.id,"REVERSED",{},"TRADE_DOCUMENT"); }
    if (original.sourceType === "TRADE_PAYMENT") { const row=await tx.tradePayment.update({ where: { journalEntryId: original.id }, data }); await audit(tx,actorId,row.id,"REVERSED",{},"TRADE_PAYMENT"); }
    await audit(tx, actorId, original.id, "REVERSED", { reversalId: reversal.id });
    await audit(tx, actorId, reversal.id, "POSTED_REVERSAL", { reverseOfId: original.id });
    return reversal;
  }, { timeout: 30000 });
}
