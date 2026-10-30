import "server-only";
import { z } from "zod";
import { getPrisma } from "../db";
import { mainTypes } from "./catalog";
import type { Prisma,PrismaClient } from "../../generated/prisma/client";

export const coaFilterSchema = z.object({
  q: z.string().trim().max(100).catch(""), type: z.enum(["", ...mainTypes]).catch(""),
  status: z.enum(["all", "active", "inactive"]).catch("all"),
  review: z.enum(["all", "pending", "reviewed"]).catch("all"),
  page: z.coerce.number().int().min(1).max(100000).catch(1),
});
export type CoaFilters = z.infer<typeof coaFilterSchema>;
export async function listAccounts(filters: CoaFilters, client?:PrismaClient) {
  const where: Prisma.AccountWhereInput = {
    ...(filters.q ? { OR: [{ code: { contains: filters.q, mode: "insensitive" } }, { name: { contains: filters.q, mode: "insensitive" } }, { description: { contains: filters.q, mode: "insensitive" } }] } : {}),
    ...(filters.type ? { mainType: filters.type } : {}),
    ...(filters.status !== "all" ? { isActive: filters.status === "active" } : {}),
    ...(filters.review === "pending" ? { requiresReview: true, reviewedAt: null } : filters.review === "reviewed" ? { reviewedAt: { not: null } } : {}),
  };
  try {
    const db=client??getPrisma();
    return await db.$transaction(async tx => {
      const total = await tx.account.count({ where });
      const pages = Math.max(1, Math.ceil(total / 20));
      const page = Math.min(filters.page, pages);
      const accounts = await tx.account.findMany({ where, orderBy: [{ code: "asc" }, { id: "asc" }],
        skip: (page - 1) * 20, take: 20, include: { _count: { select: { usageRecords: true } } } });
      return { accounts, total, pages, page };
    }, { isolationLevel: "RepeatableRead" });
  } catch { throw new Error("Daftar akun belum dapat dimuat. Periksa konfigurasi Neon dan migrasi melalui pengelola aplikasi."); }
}
export async function findAccount(id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  try { return await getPrisma().account.findUnique({ where: { id }, include: { _count: { select: { usageRecords: true } } } }); }
  catch { throw new Error("Detail akun belum dapat dimuat."); }
}

