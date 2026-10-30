import type { SeedAccount } from "./seed-plan";
import { SeedPreflightError } from "./seed-plan";
export type ExistingSeedAccount = { id: string; code: string; sourceRow: number | null; sourceCode: string | null; sourceName: string | null };
export type SeedRepository = {
  listAccounts(): Promise<ExistingSeedAccount[]>;
  deletedSourceRows(): Promise<number[]>;
  createAccount(account: SeedAccount): Promise<{ id: string }>;
};
export async function seedAccounts(plan: SeedAccount[], repository: SeedRepository) {
  const accounts = await repository.listAccounts();
  const deleted = new Set(await repository.deletedSourceRows());
  const rows = new Map(accounts.filter(a => a.sourceRow !== null).map(a => [a.sourceRow, a]));
  const codes = new Map(accounts.map(a => [a.code, a]));
  // Check every collision before the first write; outer DB transaction handles all-or-nothing.
  for (const item of plan) {
    const existing = rows.get(item.sourceRow);
    if (existing && (existing.sourceCode !== item.sourceCode || existing.sourceName !== item.sourceName)) {
      throw new SeedPreflightError("Provenance akun berubah pada baris " + item.sourceRow + "; perlu review manual.");
    }
    if (!existing && !deleted.has(item.sourceRow) && codes.has(item.code)) {
      throw new SeedPreflightError("Kode " + item.code + " telah dipakai akun lain/admin; seed tidak menimpa atau mengadopsinya.");
    }
  }
  let created = 0, skipped = 0, preservedDeleted = 0;
  for (const item of plan) {
    if (rows.has(item.sourceRow)) { skipped++; continue; }
    if (deleted.has(item.sourceRow)) { preservedDeleted++; continue; }
    await repository.createAccount(item);
    created++;
  }
  return { created, skipped, preservedDeleted, sourceAccounts: plan.length };
}

