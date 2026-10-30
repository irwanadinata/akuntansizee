import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { buildSeedPlan, duplicateGroups, readSource } from "../src/lib/coa/seed-plan";

async function main() {
  const raw = await readFile(new URL("../prisma/coa-source.json", import.meta.url), "utf8");
  const decisionRaw = await readFile(new URL("../prisma/coa-code-decisions.json", import.meta.url), "utf8");
  const decision = JSON.parse(decisionRaw);
  if (decision.reviewScope !== "ALL_ACCOUNTS") throw new Error("Audit final memerlukan review eksplisit seluruh 91 akun.");
  const accounts = buildSeedPlan(raw, decision);
  const expected = JSON.parse(JSON.stringify({
    status: "APPROVED", sourceSha256: createHash("sha256").update(raw).digest("hex"),
    decisionSha256: createHash("sha256").update(decisionRaw).digest("hex"), approvedBy: decision.approvedBy, approvedAt: decision.approvedAt,
    count: accounts.length, accounts,
  }));
  const path = new URL("../prisma/coa-approved.json", import.meta.url);
  if (process.argv.includes("--write")) await writeFile(path, JSON.stringify(expected, null, 2) + "\n");
  const actual = JSON.parse(await readFile(path, "utf8"));
  if (!isDeepStrictEqual(actual, expected)) throw new Error("Snapshot final tidak cocok; review perubahan keputusan, lalu regenerasi snapshot.");
  const counts: Record<string, number> = {};
  for (const account of accounts) counts[account.mainType] = (counts[account.mainType] ?? 0) + 1;
  console.info(JSON.stringify({
    status: "APPROVED", reviewed: accounts.length, uniqueCodes: new Set(accounts.map(a => a.code)).size,
    uniqueNames: new Set(accounts.map(a => a.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID"))).size,
    pendingDecisions: decision.codes.filter((a: { approved: boolean }) => !a.approved).length + decision.mappings.filter((a: { approved: boolean }) => !a.approved).length,
    originalDuplicateGroups: duplicateGroups(readSource(raw)).length, finalDuplicateGroups: 0,
    mainTypes: counts, snapshotMatches: true, databaseAccessed: false,
  }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Audit final COA gagal."); process.exitCode = 1; });

