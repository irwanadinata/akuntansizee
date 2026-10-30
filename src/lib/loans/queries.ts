import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { loanBalance, loanMovements } from "./balances";
export const loanFilters = z.object({ q: z.string().trim().max(100).catch(""), year: z.string().regex(/^(19|20|21)\d{2}$/).or(z.literal("")).catch(""),
  status: z.enum(["all", "unpaid", "paid", "cancelled"]).catch("all"), page: z.coerce.number().int().min(1).max(100000).catch(1) });
type LoanRow = { id: string; loanNumber: string; employeeName: string; date: Date; amount: Prisma.Decimal; remaining: Prisma.Decimal; paid: Prisma.Decimal; reversalEntryId: string | null };
export async function loanList(db: PrismaClient, input: z.infer<typeof loanFilters>) {
  const q = "%" + input.q.replace(/[\\%_]/g, char => "\\" + char) + "%";
  const conditions = Prisma.sql`WHERE (${input.q}='' OR l."employeeName" ILIKE ${q} OR l."loanNumber" ILIKE ${q} OR EXISTS(SELECT 1 FROM "LoanPayment" p WHERE p."loanId"=l."id" AND p."paymentNumber" ILIKE ${q}))
    ${input.year ? Prisma.sql`AND l."date">=${input.year + "-01-01"}::date AND l."date"<=${input.year + "-12-31"}::date` : Prisma.empty}
    ${input.status === "cancelled" ? Prisma.sql`AND l."reversalEntryId" IS NOT NULL` : input.status === "paid" ? Prisma.sql`AND l."reversalEntryId" IS NULL AND COALESCE(b.remaining,0)=0` : input.status === "unpaid" ? Prisma.sql`AND l."reversalEntryId" IS NULL AND COALESCE(b.remaining,0)>0` : Prisma.empty}`;
  const cte = Prisma.sql`WITH m AS (${loanMovements}), b AS (SELECT "loanId",SUM(net) AS remaining, -SUM(net) FILTER(WHERE kind='PAYMENT') AS paid FROM m GROUP BY "loanId")`;
  return db.$transaction(async tx => {
    const [count] = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`${cte} SELECT COUNT(*) AS count FROM "Loan" l LEFT JOIN b ON b."loanId"=l."id" ${conditions}`);
    const total = Number(count.count), pages = Math.max(1, Math.ceil(total / 30)), page = Math.min(input.page, pages);
    const rows = await tx.$queryRaw<LoanRow[]>(Prisma.sql`${cte} SELECT l."id",l."loanNumber",l."employeeName",l."date",l."amount",l."reversalEntryId",COALESCE(b.remaining,0) AS remaining,COALESCE(b.paid,0) AS paid
      FROM "Loan" l LEFT JOIN b ON b."loanId"=l."id" ${conditions} ORDER BY l."date" DESC,l."createdAt" DESC,l."id" DESC LIMIT 30 OFFSET ${(page-1)*30}`);
    return { total, pages, page, rows: rows.map(row => ({ ...row, amount: row.amount.toFixed(0), remaining: row.remaining.toFixed(0), paid: row.paid.toFixed(0) })) };
  }, { isolationLevel: "RepeatableRead" });
}
export function cashChoices(db: PrismaClient) {
  return db.account.findMany({ where: { isActive: true, mainType: "ASSET", reportGroup: "CASH_BANK", normalBalance: "DEBIT", isContra: false, isControlAccount: false,
    OR: [{ requiresReview: false }, { reviewedAt: { not: null } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}
export async function loanDetail(db: PrismaClient, id: string, requestedPage=1) {
  return db.$transaction(async tx => {
    const loan = await tx.loan.findUnique({ where: { id }, include: { journalEntry: true, reversalEntry: true, cashAccount: { select: { name: true } } } });
    if (!loan) return null;
    const total = await tx.loanPayment.count({ where: { loanId: id } }), pages = Math.max(1,Math.ceil(total/30)), page=Math.min(requestedPage,pages);
    const payments = await tx.loanPayment.findMany({ where: { loanId: id }, orderBy: [{ date: "desc" },{ createdAt: "desc" },{ id: "desc" }], take:30,skip:(page-1)*30, include: { journalEntry: true, reversalEntry: true, cashAccount: { select: { name: true } } } });
    return { loan, payments, balance: await loanBalance(tx,id), total, pages, page };
  }, { isolationLevel: "RepeatableRead" });
}
