import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { tradeBalance, tradeMovements } from "./balances";
import type { TradeKind } from "./validation";
export { cashChoices } from "../loans/queries";
export const tradeFilters = z.object({ q: z.string().trim().max(100).catch(""), year: z.string().regex(/^(19|20|21)\d{2}$/).or(z.literal("")).catch(""),
  status: z.enum(["all", "unpaid", "partial", "paid", "cancelled"]).catch("all"), page: z.coerce.number().int().min(1).max(100000).catch(1) });
type TradeRow = { id: string; documentNumber: string; partyName: string; externalReference: string | null; date: Date; amount: Prisma.Decimal; remaining: Prisma.Decimal; paid: Prisma.Decimal; reversalEntryId: string | null };
export async function tradeList(db: PrismaClient, kind: TradeKind, input: z.infer<typeof tradeFilters>) {
  const q = "%" + input.q.replace(/[\\%_]/g, char => "\\" + char) + "%";
  const conditions = Prisma.sql`WHERE d."kind"=${kind}::"TradeKind" AND (${input.q}='' OR d."partyName" ILIKE ${q} OR d."documentNumber" ILIKE ${q} OR d."externalReference" ILIKE ${q}
    OR EXISTS(SELECT 1 FROM "TradePayment" p WHERE p."documentId"=d."id" AND p."paymentNumber" ILIKE ${q}))
    ${input.year ? Prisma.sql`AND d."date">=${input.year + "-01-01"}::date AND d."date"<=${input.year + "-12-31"}::date` : Prisma.empty}
    ${input.status === "cancelled" ? Prisma.sql`AND d."reversalEntryId" IS NOT NULL` : input.status === "paid" ? Prisma.sql`AND d."reversalEntryId" IS NULL AND COALESCE(b.remaining,0)=0` :
      input.status === "partial" ? Prisma.sql`AND d."reversalEntryId" IS NULL AND COALESCE(b.remaining,0)>0 AND COALESCE(b.paid,0)>0` :
        input.status === "unpaid" ? Prisma.sql`AND d."reversalEntryId" IS NULL AND COALESCE(b.remaining,0)>0 AND COALESCE(b.paid,0)=0` : Prisma.empty}`;
  const cte = Prisma.sql`WITH m AS (${tradeMovements}), b AS (SELECT "documentId",SUM(net) AS remaining,-SUM(net) FILTER(WHERE event='PAYMENT') AS paid FROM m WHERE "kind"=${kind}::"TradeKind" GROUP BY "documentId")`;
  return db.$transaction(async tx => {
    const [count] = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`${cte} SELECT COUNT(*) AS count FROM "TradeDocument" d LEFT JOIN b ON b."documentId"=d."id" ${conditions}`);
    const total = Number(count.count), pages = Math.max(1, Math.ceil(total/30)), page = Math.min(input.page,pages);
    const rows = await tx.$queryRaw<TradeRow[]>(Prisma.sql`${cte} SELECT d."id",d."documentNumber",d."partyName",d."date",d."amount",d."externalReference",d."reversalEntryId",COALESCE(b.remaining,0) AS remaining,COALESCE(b.paid,0) AS paid
      FROM "TradeDocument" d LEFT JOIN b ON b."documentId"=d."id" ${conditions} ORDER BY d."date" DESC,d."createdAt" DESC,d."id" DESC LIMIT 30 OFFSET ${(page-1)*30}`);
    return { total,pages,page,rows: rows.map(row => ({ ...row,amount:row.amount.toFixed(0),remaining:row.remaining.toFixed(0),paid:row.paid.toFixed(0) })) };
  }, { isolationLevel:"RepeatableRead" });
}
export function counterChoices(db: PrismaClient, kind: TradeKind) {
  const policy: Prisma.AccountWhereInput = kind === "RECEIVABLE" ? { mainType:"REVENUE",normalBalance:"CREDIT" } : { mainType:{ in:["EXPENSE","COGS","ASSET"] },normalBalance:"DEBIT",reportGroup:{not:"CASH_BANK"} };
  return db.account.findMany({ where: { ...policy,isActive:true,isControlAccount:false,isContra:false,OR:[{requiresReview:false},{reviewedAt:{not:null}}] },
    select:{id:true,name:true,mainType:true,reportGroup:true},orderBy:[{mainType:"asc"},{name:"asc"}] });
}
export async function tradeDetail(db: PrismaClient, kind: TradeKind, id: string, requestedPage=1) {
  return db.$transaction(async tx => {
    const document = await tx.tradeDocument.findUnique({ where:{id},include:{journalEntry:true,reversalEntry:true,counterAccount:{select:{name:true}}} });
    if (!document || document.kind !== kind) return null;
    const total = await tx.tradePayment.count({where:{documentId:id}}),pages=Math.max(1,Math.ceil(total/30)),page=Math.min(requestedPage,pages);
    const payments = await tx.tradePayment.findMany({where:{documentId:id},orderBy:[{date:"desc"},{createdAt:"desc"},{id:"desc"}],take:30,skip:(page-1)*30,
      include:{journalEntry:true,reversalEntry:true,cashAccount:{select:{name:true}}} });
    return { document,payments,balance:await tradeBalance(tx,id),total,pages,page };
  },{isolationLevel:"RepeatableRead"});
}
