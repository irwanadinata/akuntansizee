import type { Prisma } from "../../generated/prisma/client";
import { accountInputSchema, assertCanDelete, assertCanEdit, CoaError, mustReview, type AccountInput } from "./validation";
import { lockCoa } from "./seed-database";

function fields(input: AccountInput) {
  const requiresReview = mustReview(input);
  return {
    code: input.code, name: input.name, description: input.description || null,
    mainType: input.mainType, reportGroup: input.reportGroup, normalBalance: input.normalBalance,
    isContra: input.isContra, isControlAccount: input.isControlAccount, isActive: input.isActive,
    requiresReview, reviewReason: requiresReview ? input.reviewReason || "Klasifikasi memerlukan review admin." : null,
    reviewedAt: input.reviewConfirmed ? new Date() : null,
  };
}
async function audit(tx: Prisma.TransactionClient, actorId: string, action: string, account: { id: string; sourceRow: number | null }, details: unknown) {
  await tx.coaChange.create({ data: { accountId: account.id, sourceRow: account.sourceRow, actorId, action,
    details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue } });
}
async function getLocked(tx: Prisma.TransactionClient, id: string, version: number) {
  await lockCoa(tx);
  await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = await tx.account.findUnique({ where: { id }, include: { _count: { select: { usageRecords: true } } } });
  if (!row) throw new CoaError("Akun tidak ditemukan.");
  if (row.version !== version) throw new CoaError("Akun sudah berubah. Muat ulang halaman sebelum menyimpan.");
  return row;
}
export async function createAccountInTransaction(tx: Prisma.TransactionClient, actorId: string, raw: unknown) {
  const input = accountInputSchema.parse(raw);
  await lockCoa(tx);
  const row = await tx.account.create({ data: fields(input) });
  await audit(tx, actorId, "CREATE", row, { after: fields(input) });
  return row;
}
export async function editAccountInTransaction(tx: Prisma.TransactionClient, actorId: string, id: string, version: number, raw: unknown) {
  const input = accountInputSchema.parse(raw);
  const row = await getLocked(tx, id, version);
  assertCanEdit({ ...row, usageCount: row._count.usageRecords }, input);
  const data = fields({ ...input, requiresReview: row.requiresReview || input.requiresReview });
  if (data.requiresReview && data.isActive && !data.reviewedAt) throw new CoaError("Review akun harus disahkan sebelum akun diaktifkan.");
  const updated = await tx.account.update({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
  await audit(tx, actorId, "UPDATE", row, { before: row, after: updated });
  return updated;
}
export async function setAccountActiveInTransaction(tx: Prisma.TransactionClient, actorId: string, id: string, version: number, active: boolean) {
  const row = await getLocked(tx, id, version);
  if (active && row.requiresReview && !row.reviewedAt) throw new CoaError("Periksa dan setujui klasifikasi melalui Ubah sebelum mengaktifkan akun.");
  const updated = await tx.account.update({ where: { id, version }, data: { isActive: active, version: { increment: 1 } } });
  await audit(tx, actorId, active ? "ACTIVATE" : "ARCHIVE", row, { isActive: active });
  return updated;
}
export async function deleteAccountInTransaction(tx: Prisma.TransactionClient, actorId: string, id: string, version: number, confirmation: string) {
  const row = await getLocked(tx, id, version);
  if (confirmation !== row.code) throw new CoaError("Konfirmasi kode akun tidak sesuai.");
  assertCanDelete({ usedAt: row.usedAt, usageCount: row._count.usageRecords });
  await audit(tx, actorId, "DELETE", row, { code: row.code, name: row.name, sourceRow: row.sourceRow });
  await tx.account.delete({ where: { id, version } });
}

