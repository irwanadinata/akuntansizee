import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
export const journalFilters = z.object({
  q: z.string().trim().max(100).catch(""), status: z.enum(["", "DRAFT", "POSTED", "REVERSED"]).catch(""),
  year: z.string().regex(/^\d{4}$/).or(z.literal("")).catch(""), page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export async function journalList(db: PrismaClient, filters: z.infer<typeof journalFilters>) {
  const where: Prisma.JournalEntryWhereInput = {
    ...(filters.status ? { status: filters.status } : {}), ...(filters.year ? { fiscalYear: { year: Number(filters.year) } } : {}),
    ...(filters.q ? { OR: [{ journalNumber: { contains: filters.q, mode: "insensitive" } }, { description: { contains: filters.q, mode: "insensitive" } }] } : {}),
  };
  return db.$transaction(async tx => {
    const total = await tx.journalEntry.count({ where });
    const pages = Math.max(1, Math.ceil(total / 30)), page = Math.min(filters.page, pages);
    const entries = await tx.journalEntry.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: 30, skip: (page - 1) * 30, include: { lines: { select: { debit: true } } } });
    return { entries, total, pages, page };
  }, { isolationLevel: "RepeatableRead" });
}
export async function journalChoices(db: PrismaClient) {
  return db.account.findMany({ where: { isActive: true, isControlAccount: false, OR: [{ requiresReview: false }, { reviewedAt: { not: null } }] }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
}
