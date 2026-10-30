import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { validBusinessDate } from "../accounting/dates";
import { TRADE_CONTROL_CODES, type TradeKind, TradeError } from "./validation";
export type TradeTx = Prisma.TransactionClient;
// A positive normalized movement increases outstanding for either AR or AP.
export const tradeMovements = Prisma.sql`
 SELECT d."id" AS "documentId", d."kind", e."id" AS "entryId", e."date", e."postedAt",
   CASE WHEN d."kind"='RECEIVABLE' THEN ln."debit"-ln."credit" ELSE ln."credit"-ln."debit" END AS net, 'DOCUMENT' AS event
 FROM "TradeDocument" d JOIN "JournalEntry" e ON e."id"=d."journalEntryId" OR e."id"=d."reversalEntryId"
 JOIN "JournalLine" ln ON ln."entryId"=e."id" AND ln."accountId"=d."controlAccountId" WHERE e."postingStatus"='POSTED'
 UNION ALL
 SELECT p."documentId", d."kind", e."id", e."date", e."postedAt",
   CASE WHEN d."kind"='RECEIVABLE' THEN ln."debit"-ln."credit" ELSE ln."credit"-ln."debit" END, 'PAYMENT'
 FROM "TradePayment" p JOIN "TradeDocument" d ON d."id"=p."documentId"
 JOIN "JournalEntry" e ON e."id"=p."journalEntryId" OR e."id"=p."reversalEntryId"
 JOIN "JournalLine" ln ON ln."entryId"=e."id" AND ln."accountId"=d."controlAccountId" WHERE e."postingStatus"='POSTED'`;
export async function tradeBalance(tx: TradeTx, id: string) {
  const [row] = await tx.$queryRaw<{ remaining: Prisma.Decimal; paid: Prisma.Decimal; minimum: Prisma.Decimal }[]>(Prisma.sql`
    WITH m AS (${tradeMovements}), r AS (SELECT *, SUM(net) OVER(ORDER BY "date","postedAt","entryId") AS running FROM m WHERE "documentId"=${id}::uuid)
    SELECT COALESCE(SUM(net),0) AS remaining, COALESCE(-SUM(net) FILTER(WHERE event='PAYMENT'),0) AS paid, COALESCE(MIN(running),0) AS minimum FROM r`);
  return { remaining: row.remaining.toFixed(0), paid: row.paid.toFixed(0), minimum: row.minimum.toFixed(0) };
}
export async function tradeReconciliation(db: PrismaClient, kind: TradeKind, asOf?: string) {
  if (asOf && !validBusinessDate(asOf)) throw new TradeError("Tanggal rekonsiliasi tidak sah.");
  return db.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ detail: Prisma.Decimal; control: Prisma.Decimal }[]>(Prisma.sql`
      WITH m AS (${tradeMovements}) SELECT
      (SELECT COALESCE(SUM(net),0) FROM m WHERE "kind"=${kind}::"TradeKind" ${asOf ? Prisma.sql`AND "date"<=${asOf}::date` : Prisma.empty}) AS detail,
      (SELECT COALESCE(SUM(${kind === "RECEIVABLE" ? Prisma.sql`ln."debit"-ln."credit"` : Prisma.sql`ln."credit"-ln."debit"`}),0)
       FROM "JournalLine" ln JOIN "JournalEntry" e ON e."id"=ln."entryId" JOIN "Account" a ON a."id"=ln."accountId"
       WHERE a."code"=${TRADE_CONTROL_CODES[kind]} AND e."postingStatus"='POSTED' ${asOf ? Prisma.sql`AND e."date"<=${asOf}::date` : Prisma.empty}) AS control`);
    return { detail: row.detail.toFixed(0), control: row.control.toFixed(0), difference: (BigInt(row.detail.toFixed(0)) - BigInt(row.control.toFixed(0))).toString() };
  }, { isolationLevel: "RepeatableRead" });
}
