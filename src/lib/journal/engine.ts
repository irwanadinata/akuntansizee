import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { asDate } from "../accounting/dates";
import { boundedCommand, newJournalNumber, payloadHash } from "./identity";
import { assertBalanced, createDraftSchema, editDraftSchema, targetSchema, reverseSchema, yearCreateSchema, yearStatusSchema, JournalError, type JournalLineInput } from "./validation";
import { z } from "zod";

export type JournalOperation = "CREATE_DRAFT" | "EDIT_DRAFT" | "POST" | "REVERSE" | "DELETE_DRAFT" | "CREATE_YEAR" | "SET_YEAR_STATUS";
const resultSchema = z.object({ id: z.uuid(), entity: z.enum(["JOURNAL", "FISCAL_YEAR"]), journalNumber: z.string().nullable(), status: z.string(), version: z.number().int() });
export type CommandResult = z.infer<typeof resultSchema>;
export type JournalDependencies = { now?: () => Date; number?: (now: Date) => string };
type Tx = Prisma.TransactionClient;
type Clock = () => Date;
export async function audit(tx: Tx, actorId: string, entityId: string, action: string, details: unknown, entity = "JOURNAL") {
  await tx.auditEvent.create({ data: { actorId, entityId, entity, action, details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue } });
}
function result(entry: { id: string; journalNumber: string; status: string; version: number }): CommandResult {
  return { id: entry.id, entity: "JOURNAL", journalNumber: entry.journalNumber, status: entry.status, version: entry.version };
}
async function command(db: PrismaClient, actorId: string, operation: JournalOperation, requestKey: string, payload: unknown, work: (tx: Tx) => Promise<CommandResult>) {
  const fingerprint = payloadHash(payload);
  return boundedCommand(() => db.$transaction(async tx => {
    const scope = actorId + ":" + operation + ":" + requestKey;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))::text`;
    const existing = await tx.journalRequest.findUnique({ where: { actorId_operation_requestKey: { actorId, operation, requestKey } } });
    if (existing) {
      if (existing.payloadHash !== fingerprint) throw new JournalError("Permintaan yang sama membawa isi berbeda. Muat ulang dan kirim sebagai tindakan baru.");
      return resultSchema.parse(existing.result);
    }
    const output = await work(tx);
    await tx.journalRequest.create({ data: { actorId, operation, requestKey, payloadHash: fingerprint, result: output } });
    return output;
  }, { timeout: 20000, maxWait: 10000 }));
}
export async function openYear(tx: Tx, date: Date, allowHistoricalDraft = false) {
  // Opening initialization takes the exclusive lock before fiscal/account locks.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('zee:opening-cutover', 0))::text`;
  const year = date.getUTCFullYear();
  await tx.$queryRaw`SELECT "id" FROM "FiscalYear" WHERE "year" = ${year} FOR SHARE`;
  const fiscal = await tx.fiscalYear.findUnique({ where: { year } });
  if (!fiscal) throw new JournalError("Tahun buku " + year + " belum dibuat. Tambahkan melalui Tahun Buku.");
  if (fiscal.status !== "OPEN" || date < fiscal.startDate || date > fiscal.endDate) throw new JournalError("Periode terkunci atau tanggal di luar tahun buku. Transaksi ditolak.");
  if (!allowHistoricalDraft) {
    const opening = await tx.openingJournal.findUnique({ where: { singletonKey: 1 }, select: { cutoverDate: true } });
    if (opening && date < opening.cutoverDate) throw new JournalError("Tanggal posting tidak boleh mendahului cutover saldo pembukaan. Periksa tanggal transaksi.");
  }
  return fiscal;
}
async function lockedEntry(tx: Tx, id: string, version: number) {
  await tx.$queryRaw`SELECT "id" FROM "JournalEntry" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const entry = await tx.journalEntry.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!entry) throw new JournalError("Jurnal tidak ditemukan.");
  if (entry.version !== version) throw new JournalError("Jurnal sudah berubah. Muat ulang halaman sebelum melanjutkan.");
  return entry;
}
export async function accounts(tx: Tx, lines: JournalLineInput[], reversal = false, allowedControlId?: string) {
  const ids = [...new Set(lines.map(line => line.accountId))].sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" WHERE "id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`);
  const rows = await tx.account.findMany({ where: { id: { in: ids } } });
  if (rows.length !== ids.length) throw new JournalError("Ada akun yang tidak ditemukan.");
  for (const account of rows) {
    if (account.isControlAccount && account.id !== allowedControlId) throw new JournalError("Akun kontrol piutang/utang/pinjaman tidak boleh dijurnal manual. Gunakan modul dengan rincian subledger.");
    if (!reversal && (!account.isActive || (account.requiresReview && !account.reviewedAt))) throw new JournalError("Akun nonaktif atau belum direview tidak dapat dipakai.");
  }
}
export async function writeLines(tx: Tx, id: string, lines: JournalLineInput[]) {
  await tx.journalLine.createMany({ data: lines.map((line, index) => ({ entryId: id, lineNo: index + 1, accountId: line.accountId,
    debit: line.debit, credit: line.credit, description: line.description || null })) });
  const previous = await tx.accountUsage.findMany({ where: { sourceType: "JOURNAL", sourceId: id }, select: { accountId: true } });
  const seen = new Set(previous.map(row => row.accountId));
  const added = [...new Set(lines.map(line => line.accountId))].filter(accountId => !seen.has(accountId));
  if (added.length) await tx.accountUsage.createMany({ data: added.map(accountId => ({ accountId, sourceType: "JOURNAL", sourceId: id })) });
}
function draftOnly(entry: { status: string; sourceType: string }) {
  if (entry.status !== "DRAFT" || entry.sourceType !== "MANUAL") throw new JournalError("Jurnal terposting tidak dapat diubah atau dihapus. Gunakan jurnal pembalik.");
}
export async function reserve(tx: Tx, now: Clock, number: (now: Date) => string) {
  const journalNumber = number(now());
  if (!/^JRN-\d{8}-[A-Z0-9]{12}$/.test(journalNumber)) throw new JournalError("Format nomor jurnal server tidak sah.");
  await tx.journalNumber.create({ data: { journalNumber } });
  return journalNumber;
}
export async function executeJournalCommand(db: PrismaClient, actorId: string, operation: JournalOperation, raw: unknown, dependencies: JournalDependencies = {}): Promise<CommandResult> {
  const now = dependencies.now ?? (() => new Date());
  const number = dependencies.number ?? newJournalNumber;
  if (operation === "CREATE_DRAFT") {
    const input = createDraftSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const date = asDate(input.date), year = await openYear(tx, date, true);
      await accounts(tx, input.lines);
      const entry = await tx.journalEntry.create({ data: { journalNumber: await reserve(tx, now, number), date,
        description: input.description, fiscalYearId: year.id, createdById: actorId } });
      await writeLines(tx, entry.id, input.lines);
      await audit(tx, actorId, entry.id, "CREATED", { journalNumber: entry.journalNumber, date: input.date, lines: input.lines });
      return result(entry);
    });
  }
  if (operation === "EDIT_DRAFT") {
    const input = editDraftSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const entry = await lockedEntry(tx, input.id, input.version); draftOnly(entry);
      await openYear(tx, entry.date, true); // No moving a draft out of a locked year.
      const date = asDate(input.date), year = await openYear(tx, date, true);
      await accounts(tx, input.lines);
      await tx.journalLine.deleteMany({ where: { entryId: entry.id } });
      const updated = await tx.journalEntry.update({ where: { id: entry.id, version: input.version },
        data: { date, description: input.description, fiscalYearId: year.id, version: { increment: 1 } } });
      await writeLines(tx, entry.id, input.lines);
      await audit(tx, actorId, entry.id, "UPDATED", { journalNumber: entry.journalNumber, before: entry, after: input });
      return result(updated);
    });
  }
  if (operation === "POST") {
    const input = targetSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const entry = await lockedEntry(tx, input.id, input.version); draftOnly(entry);
      await openYear(tx, entry.date);
      const lines = entry.lines.map(line => ({ accountId: line.accountId, debit: line.debit.toFixed(0), credit: line.credit.toFixed(0), description: line.description ?? "" }));
      assertBalanced(lines); await accounts(tx, lines);
      const updated = await tx.journalEntry.update({ where: { id: entry.id, version: input.version },
        data: { status: "POSTED", postingStatus: "POSTED", postedAt: now(), postedById: actorId, version: { increment: 1 } } });
      await audit(tx, actorId, entry.id, "POSTED", { journalNumber: entry.journalNumber });
      return result(updated);
    });
  }
  if (operation === "REVERSE") {
    const input = reverseSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      return reverseInTransaction(tx, actorId, input, { now, number });
    });
  }
  if (operation === "DELETE_DRAFT") {
    const input = targetSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const entry = await lockedEntry(tx, input.id, input.version); draftOnly(entry); await openYear(tx, entry.date, true);
      await audit(tx, actorId, entry.id, "DELETED_DRAFT", { journalNumber: entry.journalNumber, snapshot: entry });
      await tx.journalEntry.delete({ where: { id: entry.id, version: input.version } });
      return { ...result(entry), status: "DELETED" };
    });
  }
  if (operation === "CREATE_YEAR") {
    const input = yearCreateSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const fiscal = await tx.fiscalYear.create({ data: { year: input.year, startDate: asDate(input.year + "-01-01"), endDate: asDate(input.year + "-12-31") } });
      await audit(tx, actorId, fiscal.id, "CREATED", { year: fiscal.year }, "FISCAL_YEAR");
      return { id: fiscal.id, entity: "FISCAL_YEAR", journalNumber: null, status: fiscal.status, version: fiscal.version };
    });
  }
  const input = yearStatusSchema.parse(raw);
  return command(db, actorId, operation, input.requestKey, input, async tx => {
    await tx.$queryRaw`SELECT "id" FROM "FiscalYear" WHERE "id" = ${input.id}::uuid FOR UPDATE`;
    const fiscal = await tx.fiscalYear.findUnique({ where: { id: input.id } });
    if (!fiscal || fiscal.version !== input.version) throw new JournalError("Tahun buku tidak ditemukan atau sudah berubah.");
    const updated = await tx.fiscalYear.update({ where: { id: fiscal.id, version: input.version }, data: { status: input.status, version: { increment: 1 } } });
    await audit(tx, actorId, fiscal.id, input.status === "LOCKED" ? "LOCKED" : "OPENED", { year: fiscal.year, reason: input.reason }, "FISCAL_YEAR");
    return { id: updated.id, entity: "FISCAL_YEAR", journalNumber: null, status: updated.status, version: updated.version };
  });
}

// Used only inside the owning module transaction; automatic sources cannot use the manual action.
export async function reverseInTransaction(tx: Tx, actorId: string, input: z.infer<typeof reverseSchema>, dependencies: JournalDependencies = {}, expectedSource: "MANUAL" | "LOAN" | "LOAN_PAYMENT" | "TRADE_DOCUMENT" | "TRADE_PAYMENT" = "MANUAL", allowedControlId?: string) {
  const now = dependencies.now ?? (() => new Date()), number = dependencies.number ?? newJournalNumber;
      const entry = await lockedEntry(tx, input.id, input.version);
      if (entry.status !== "POSTED" || entry.sourceType !== expectedSource || entry.reverseOfId) throw new JournalError("Jurnal ini tidak dapat dibalik lagi.");
      const date = asDate(input.date);
      if (date < entry.date) throw new JournalError("Tanggal pembalik tidak boleh mendahului jurnal asal.");
      const year = await openYear(tx, date);
      const lines = entry.lines.map(line => ({ accountId: line.accountId, debit: line.credit.toFixed(0), credit: line.debit.toFixed(0), description: line.description ?? "" }));
      assertBalanced(lines); await accounts(tx, lines, true, allowedControlId);
      const reverse = await tx.journalEntry.create({ data: { journalNumber: await reserve(tx, now, number), date,
        description: "Pembalik " + entry.journalNumber + ": " + input.reason, fiscalYearId: year.id, sourceType: "REVERSAL",
        reverseOfId: entry.id, reversalReason: input.reason, createdById: actorId } });
      await writeLines(tx, reverse.id, lines);
      const posted = await tx.journalEntry.update({ where: { id: reverse.id }, data: { status: "POSTED", postingStatus: "POSTED",
        postedAt: now(), postedById: actorId, version: { increment: 1 } } });
      await tx.journalEntry.update({ where: { id: entry.id, version: input.version }, data: { status: "REVERSED",
        reversedAt: now(), reversedById: actorId, reversalReason: input.reason, version: { increment: 1 } } });
      await audit(tx, actorId, entry.id, "REVERSED", { journalNumber: entry.journalNumber, reversalId: reverse.id, reversalNumber: reverse.journalNumber, reason: input.reason });
      await audit(tx, actorId, reverse.id, "POSTED_REVERSAL", { journalNumber: reverse.journalNumber, reverseOfId: entry.id, reason: input.reason });
      return result(posted);
}


