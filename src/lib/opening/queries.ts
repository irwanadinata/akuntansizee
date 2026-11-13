import type { PrismaClient } from "../../generated/prisma/client";
import { assertOpeningAccount } from "./validation";

// Use the same account policy for initialization and subsequent corrections.
export async function openingChoices(db: PrismaClient) {
  const rows = await db.account.findMany({
    where: { isActive: true, isControlAccount: false, OR: [{ requiresReview: false }, { reviewedAt: { not: null } }] },
    orderBy: { code: "asc" },
  });
  return rows.filter(account => {
    try { assertOpeningAccount(account); return true; } catch { return false; }
  }).map(({ id, code, name, mainType, reportGroup, normalBalance, isContra, isControlAccount }) => ({
    id, code, name, mainType, reportGroup, normalBalance, isContra, isControlAccount,
  }));
}
