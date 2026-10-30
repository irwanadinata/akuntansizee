import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { EMPLOYEE_CONTROL_CODE } from "./validation";
export type LoanTx = Prisma.TransactionClient;
// Every financial amount is derived from the linked POSTED journals, including reversals.
export const loanMovements = Prisma.sql`
 SELECT l."id" AS "loanId", e."id" AS "entryId", e."date", e."postedAt", ln."debit"-ln."credit" AS net, 'LOAN' AS kind
 FROM "Loan" l JOIN "JournalEntry" e ON e."id"=l."journalEntryId" OR e."id"=l."reversalEntryId"
 JOIN "JournalLine" ln ON ln."entryId"=e."id" AND ln."accountId"=l."controlAccountId" WHERE e."postingStatus"='POSTED'
 UNION ALL
 SELECT p."loanId", e."id", e."date", e."postedAt", ln."debit"-ln."credit", 'PAYMENT'
 FROM "LoanPayment" p JOIN "Loan" l ON l."id"=p."loanId"
 JOIN "JournalEntry" e ON e."id"=p."journalEntryId" OR e."id"=p."reversalEntryId"
 JOIN "JournalLine" ln ON ln."entryId"=e."id" AND ln."accountId"=l."controlAccountId" WHERE e."postingStatus"='POSTED'`;
export async function loanBalance(tx: LoanTx, id: string) {
  const [row] = await tx.$queryRaw<{ remaining: Prisma.Decimal; paid: Prisma.Decimal; minimum: Prisma.Decimal }[]>(Prisma.sql`
    WITH m AS (${loanMovements}), r AS (SELECT *, SUM(net) OVER(ORDER BY "date","postedAt","entryId") AS running FROM m WHERE "loanId"=${id}::uuid)
    SELECT COALESCE(SUM(net),0) AS remaining, COALESCE(-SUM(net) FILTER(WHERE kind='PAYMENT'),0) AS paid, COALESCE(MIN(running),0) AS minimum FROM r`);
  return { remaining: row.remaining.toFixed(0), paid: row.paid.toFixed(0), minimum: row.minimum.toFixed(0) };
}
export async function loanReconciliation(db: PrismaClient, asOf?: string) {
  return db.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ detail: Prisma.Decimal; control: Prisma.Decimal }[]>(Prisma.sql`
      WITH m AS (${loanMovements}) SELECT
      (SELECT COALESCE(SUM(net),0) FROM m ${asOf ? Prisma.sql`WHERE "date"<=${asOf}::date` : Prisma.empty}) AS detail,
      (SELECT COALESCE(SUM(ln."debit"-ln."credit"),0) FROM "JournalLine" ln JOIN "JournalEntry" e ON e."id"=ln."entryId" JOIN "Account" a ON a."id"=ln."accountId"
       WHERE a."code"=${EMPLOYEE_CONTROL_CODE} AND e."postingStatus"='POSTED' ${asOf ? Prisma.sql`AND e."date"<=${asOf}::date` : Prisma.empty}) AS control`);
    return { detail: row.detail.toFixed(0), control: row.control.toFixed(0), difference: (BigInt(row.detail.toFixed(0)) - BigInt(row.control.toFixed(0))).toString() };
  }, { isolationLevel: "RepeatableRead" });
}
