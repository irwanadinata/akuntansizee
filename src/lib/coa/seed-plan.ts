import { createHash } from "node:crypto";
import { z } from "zod";
import { classificationSchema, type Classification } from "./catalog";
import { proposeMapping, sourceAccountSchema, type SourceAccount } from "./mapping";

const identity = { sourceRow: z.number().int(), sourceCode: z.string(), name: z.string() };
const decisionSchema = z.object({
  version: z.literal(1), status: z.enum(["PENDING_APPROVAL", "APPROVED"]),
  approvedBy: z.string().nullable(), approvedAt: z.string().nullable(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  reviewScope: z.enum(["EXCEPTIONS", "ALL_ACCOUNTS"]).default("EXCEPTIONS"),
  instructions: z.string(),
  codes: z.array(z.object({ ...identity, proposedCode: z.string(), finalCode: z.string().nullable(), approved: z.boolean() }).strict()),
  mappings: z.array(z.object({ ...identity, reason: z.string(),
    proposedMapping: classificationSchema, approvedMapping: classificationSchema.nullable(), approved: z.boolean(),
    finalName: z.string().trim().min(1).max(255).optional(), finalDescription: z.string().trim().max(2000).optional(),
  }).strict()),
}).strict();
export type CodeDecisions = z.infer<typeof decisionSchema>;
export class SeedPreflightError extends Error {}
export type SeedAccount = Classification & {
  code: string; name: string; description: string; sourceRow: number; sourceCode: string; sourceName: string; sourceType: string;
  requiresReview: boolean; reviewReason: string | null; reviewedAt: Date | null; isActive: boolean;
};
export function sourceHash(raw: string) { return createHash("sha256").update(raw).digest("hex"); }
export function readSource(raw: string): SourceAccount[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new SeedPreflightError("JSON sumber COA tidak sah."); }
  const result = z.array(sourceAccountSchema).length(91).safeParse(parsed);
  if (!result.success) throw new SeedPreflightError("Sumber COA harus berisi 91 identitas akun yang sah, kode STRING, tanpa field saldo.");
  const source = result.data;
  if (new Set(source.map(a => a.sourceRow)).size !== 91 || new Set(source.map(a => a.sourceCode + "|" + a.name)).size !== 91) {
    throw new SeedPreflightError("Identitas/baris sumber COA tidak unik.");
  }
  return source;
}
export function duplicateGroups(source: SourceAccount[]) {
  const groups = new Map<string, SourceAccount[]>();
  for (const row of source) groups.set(row.sourceCode, [...(groups.get(row.sourceCode) ?? []), row]);
  return [...groups.entries()].filter(([, rows]) => rows.length > 1);
}
function classification(value: ReturnType<typeof proposeMapping>): Classification {
  return { mainType: value.mainType, reportGroup: value.reportGroup, normalBalance: value.normalBalance,
    isContra: value.isContra, isControlAccount: value.isControlAccount };
}
export function createDecisionTemplate(raw: string): CodeDecisions {
  const source = readSource(raw);
  const duplicates = new Set(duplicateGroups(source).flatMap(([, rows]) => rows.map(a => a.sourceRow)));
  return {
    version: 1, status: "PENDING_APPROVAL", approvedBy: null, approvedAt: null, sourceSha256: sourceHash(raw), reviewScope: "EXCEPTIONS",
    instructions: "USULAN SAJA. Isi finalCode dan approvedMapping setelah review, set approved setiap item, lalu isi approvedBy/approvedAt ISO dan status APPROVED. Jangan mengganti sumber asli.",
    codes: source.filter(a => duplicates.has(a.sourceRow)).map(a => ({ sourceRow: a.sourceRow, sourceCode: a.sourceCode, name: a.name,
      proposedCode: a.name === "Cadangan Kerugian Piutang" ? "1122.2" : a.name === "Prepaid PPh 23" ? "1130.3" : a.sourceCode,
      finalCode: null, approved: false })),
    mappings: source.flatMap(a => {
      const mapping = proposeMapping(a);
      return mapping.requiresReview ? [{ sourceRow: a.sourceRow, sourceCode: a.sourceCode, name: a.name,
        reason: mapping.reviewReason!, proposedMapping: classification(mapping), approvedMapping: null, approved: false }] : [];
    }),
  };
}
export function buildSeedPlan(raw: string, decisionInput: unknown): SeedAccount[] {
  const source = readSource(raw);
  const groups = duplicateGroups(source);
  if (groups.length !== 2 || !groups.some(([code, rows]) => code === "1122.1" && rows.length === 2) ||
    !groups.some(([code, rows]) => code === "1130.1" && rows.length === 2)) {
    throw new SeedPreflightError("Duplikasi sumber berubah; review ulang seluruh sumber COA.");
  }
  const detail = groups.map(([code, rows]) => code + ": " + rows.map(a => a.name + " (baris " + a.sourceRow + ")").join(" / ")).join("; ");
  const parsed = decisionSchema.safeParse(decisionInput);
  if (!parsed.success) throw new SeedPreflightError("Format keputusan COA tidak sah atau belum tersedia. Konflik: " + detail);
  const decisions = parsed.data;
  if (decisions.status !== "APPROVED" || !decisions.approvedBy?.trim() ||
    !decisions.approvedAt || !z.iso.datetime({ offset: true }).safeParse(decisions.approvedAt).success) {
    throw new SeedPreflightError("Seed COA DITOLAK: keputusan belum disetujui. Konflik: " + detail + ". Tidak ada database yang diubah.");
  }
  if (decisions.sourceSha256 !== sourceHash(raw)) throw new SeedPreflightError("Sumber berubah setelah review; SHA-256 keputusan tidak cocok.");
  const byRow = new Map(source.map(a => [a.sourceRow, a]));
  for (const list of [decisions.codes, decisions.mappings]) {
    if (new Set(list.map(a => a.sourceRow)).size !== list.length) throw new SeedPreflightError("Keputusan baris ganda tidak diperbolehkan.");
    for (const item of list) {
      const row = byRow.get(item.sourceRow);
      if (!row || row.sourceCode !== item.sourceCode || row.name !== item.name) throw new SeedPreflightError("Identitas keputusan tidak cocok dengan sumber.");
    }
  }
  const codes = new Map(decisions.codes.map(a => [a.sourceRow, a]));
  const mappings = new Map(decisions.mappings.map(a => [a.sourceRow, a]));
  if (decisions.reviewScope === "ALL_ACCOUNTS" && (mappings.size !== 91 || source.some(row => !mappings.has(row.sourceRow)))) {
    throw new SeedPreflightError("Review seluruh COA wajib memuat keputusan untuk masing-masing 91 akun.");
  }
  const duplicateRows = new Set(groups.flatMap(([, rows]) => rows.map(a => a.sourceRow)));
  const plan = source.map(row => {
    const proposed = proposeMapping(row);
    const code = codes.get(row.sourceRow);
    if ((duplicateRows.has(row.sourceRow) || code) && (!code?.approved || !code.finalCode)) {
      throw new SeedPreflightError("Kode final belum disahkan: " + detail);
    }
    const finalCode = code?.finalCode ?? row.sourceCode;
    if (!/^[0-9]+(?:\.[0-9]+)*$/.test(finalCode) || finalCode.length > 32) throw new SeedPreflightError("Kode final harus STRING unik yang sah.");
    const review = mappings.get(row.sourceRow);
    if ((proposed.requiresReview || review) && (!review?.approved || !review.approvedMapping)) {
      throw new SeedPreflightError("Klasifikasi perlu review dan belum disahkan: " + row.name + " (baris " + row.sourceRow + ").");
    }
    const mapped = review?.approvedMapping ?? classification(proposed);
    if (mapped.isControlAccount !== proposed.isControlAccount) throw new SeedPreflightError("Tiga peran akun kontrol sumber tidak boleh diubah melalui seed.");
    const keys = ["mainType", "reportGroup", "normalBalance", "isContra", "isControlAccount"] as const;
    const changedClassification = keys.some(key => mapped[key] !== proposed[key]);
    if (changedClassification && (proposed.isControlAccount || proposed.isContra || proposed.mainType === "OTHER_RESULT")) {
      throw new SeedPreflightError("Klasifikasi akun kontrol/kontra/hasil neto bertentangan dengan sifat akun: " + row.name);
    }
    return { ...mapped, code: finalCode, name: review?.finalName ?? row.name, description: review?.finalDescription ?? row.details, sourceRow: row.sourceRow,
      sourceCode: row.sourceCode, sourceName: row.name, sourceType: row.sourceType, requiresReview: proposed.requiresReview || changedClassification,
      reviewReason: review?.reason ?? proposed.reviewReason, reviewedAt: review ? new Date(decisions.approvedAt!) : null, isActive: true };
  });
  if (new Set(plan.map(a => a.code)).size !== 91) throw new SeedPreflightError("Kode final masih duplikat; Account.code wajib unik sebelum seed. " + detail);
  if (new Set(plan.map(a => a.name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("id-ID"))).size !== 91) {
    throw new SeedPreflightError("Nama final akun COA duplikat; periksa keputusan penamaan.");
  }
  return plan;
}

