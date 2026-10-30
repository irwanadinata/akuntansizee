import type { Prisma } from "../../generated/prisma/client";
import { seedAccounts } from "./seed-core";
import type { SeedAccount } from "./seed-plan";

export async function lockCoa(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726069456)::text`;
}
export async function seedCoaInTransaction(tx: Prisma.TransactionClient, plan: SeedAccount[], actorId: string) {
  await lockCoa(tx);
  const result = await seedAccounts(plan, {
    listAccounts: () => tx.account.findMany({ select: { id: true, code: true, sourceRow: true, sourceCode: true, sourceName: true } }),
    deletedSourceRows: async () => (await tx.coaChange.findMany({ where: { action: "DELETE", sourceRow: { not: null } }, select: { sourceRow: true } })).map(a => a.sourceRow!),
    createAccount: async data => {
      const account = await tx.account.create({ data });
      await tx.coaChange.create({ data: { accountId: account.id, actorId, action: "SEED", sourceRow: account.sourceRow,
        details: { code: account.code, name: account.name, mainType: account.mainType, normalBalance: account.normalBalance } } });
      return account;
    },
  });
  return { ...result,
    persistedSourceAccounts: await tx.account.count({ where: { sourceRow: { in: plan.map(row => row.sourceRow) } } }),
    totalAccounts: await tx.account.count(),
  };
}

