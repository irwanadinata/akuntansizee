import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { asDate } from "../accounting/dates";
import { boundedCommand, newJournalNumber, payloadHash, isNumberCollision } from "./identity";
import { assertBalanced, createJournalSchema, editJournalSchema, editOpeningJournalSchema, deleteJournalSchema, journalNumberSchema, journalOperations, yearCreateSchema, yearStatusSchema, JournalError, type JournalLineInput } from "./validation";
import { journalDeletionBlock } from "./deletion";
import { z } from "zod";
import { assertOpeningAccount } from "../opening/validation";
import { dateString } from "../accounting/dates";

export type JournalOperation = typeof journalOperations[number];
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
export async function openYear(tx: Tx, date: Date, allowLegacyUnposted = false) {
  // Opening initialization takes the exclusive lock before fiscal/account locks.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended('zee:opening-cutover', 0))::text`;
  const year = date.getUTCFullYear();
  await tx.$queryRaw`SELECT "id" FROM "FiscalYear" WHERE "year" = ${year} FOR SHARE`;
  const fiscal = await tx.fiscalYear.findUnique({ where: { year } });
  if (!fiscal) throw new JournalError("Tahun buku " + year + " belum dibuat. Tambahkan melalui Tahun Buku.");
  if (fiscal.status !== "OPEN" || date < fiscal.startDate || date > fiscal.endDate) throw new JournalError("Periode terkunci atau tanggal di luar tahun buku. Transaksi ditolak.");
  if (!allowLegacyUnposted) {
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
export async function accounts(tx: Tx, lines: JournalLineInput[], allowedControlId?: string) {
  const ids = [...new Set(lines.map(line => line.accountId))].sort();
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Account" WHERE "id" IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY "id" FOR UPDATE`);
  const rows = await tx.account.findMany({ where: { id: { in: ids } } });
  if (rows.length !== ids.length) throw new JournalError("Ada akun yang tidak ditemukan.");
  for (const account of rows) {
    if (account.isControlAccount && account.id !== allowedControlId) throw new JournalError("Akun kontrol piutang/utang/pinjaman tidak boleh dijurnal manual. Gunakan modul dengan rincian subledger.");
    if (!account.isActive || (account.requiresReview && !account.reviewedAt)) throw new JournalError("Akun nonaktif atau belum direview tidak dapat dipakai.");
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
export async function reserve(tx: Tx, now: Clock, number: (now: Date) => string, manualNumber?: string) {
  const journalNumber = manualNumber ? journalNumberSchema.parse(manualNumber) : number(now());
  if (!manualNumber && !/^JRN-\d{8}-[A-Z0-9]{12}$/.test(journalNumber)) throw new JournalError("Format nomor jurnal server tidak sah.");
  try { await tx.journalNumber.create({ data: { journalNumber } }); }
  catch (error) { if (manualNumber && isNumberCollision(error)) throw new JournalError("Nomor jurnal sudah pernah digunakan. Isi nomor lain."); throw error; }
  return journalNumber;
}
export function journalSnapshot(entry: { journalNumber: string; date: Date; description: string; version: number; lines: {accountId: string; debit: {toFixed(n: number): string}; credit: {toFixed(n: number): string}; description: string | null}[] }) {
  return { journalNumber: entry.journalNumber, date: dateString(entry.date), description: entry.description, version: entry.version,
    lines: entry.lines.map(line => ({ accountId: line.accountId, debit: line.debit.toFixed(0), credit: line.credit.toFixed(0), description: line.description ?? "" })) };
}
export async function updatePostedJournal(tx: Tx, actorId: string,
  entry: NonNullable<Awaited<ReturnType<typeof lockedEntry>>>,
  input: {journalNumber: string; date: string; description: string; lines: JournalLineInput[]; reason: string},
  dependencies: JournalDependencies = {}, allowedControlId?: string, updateSource?: () => Promise<void>) {
  if (entry.status === "REVERSED" || entry.sourceType === "REVERSAL") throw new JournalError("Riwayat jurnal yang sudah dibatalkan tidak dapat diedit.");
  await openYear(tx, entry.date, entry.postingStatus !== "POSTED");
  const date = asDate(input.date), year = await openYear(tx, date);
  const opening = await tx.openingJournal.findUnique({ where: {journalEntryId: entry.id} });
  if (!opening?.perAccount) assertBalanced(input.lines);
  await accounts(tx, input.lines, allowedControlId);
  if (opening) {
    if (date.getTime() !== opening.cutoverDate.getTime()) throw new JournalError("Tanggal cutover saldo pembukaan tetap. Ubah nominal atau akun pada tanggal pembukaan yang sama.");
    if (new Set(input.lines.map(line => line.accountId)).size !== input.lines.length) throw new JournalError("Saldo pembukaan per akun harus neto, tanpa akun berulang.");
    const rows = await tx.account.findMany({where:{id:{in:input.lines.map(line=>line.accountId)}}});
    rows.forEach(assertOpeningAccount);
    if (opening.perAccount && input.lines.some(line => {
      const account = rows.find(row => row.id === line.accountId)!;
      return account.normalBalance === "DEBIT" ? line.credit !== "0" : line.debit !== "0";
    })) throw new JournalError("Saldo pembukaan per COA harus mengikuti saldo normal akun.");
  }
  const journalNumber = input.journalNumber === entry.journalNumber ? entry.journalNumber : await reserve(tx, dependencies.now ?? (()=>new Date()), dependencies.number ?? newJournalNumber, input.journalNumber);
  const before = journalSnapshot(entry), after = { journalNumber, date: input.date, description: input.description, version: entry.version + 1, lines: input.lines };
  const [transaction] = await tx.$queryRaw<{id: string}[]>`SELECT txid_current()::text AS id`;
  await audit(tx, actorId, entry.id, "EDITED", {fromVersion: entry.version, toVersion: entry.version + 1, transactionId: transaction.id, reason: input.reason, before, after});
  await updateSource?.();
  const updated = await tx.journalEntry.update({where:{id:entry.id,version:entry.version},data:{journalNumber,date,description:input.description,fiscalYearId:year.id,
    status:"POSTED",postingStatus:"POSTED",postedAt:entry.postedAt ?? (dependencies.now ?? (()=>new Date()))(),postedById:entry.postedById ?? actorId,version:{increment:1}}});
  await tx.journalLine.deleteMany({where:{entryId:entry.id}});
  await writeLines(tx, entry.id, input.lines);
  if (entry.postingStatus !== "POSTED") await audit(tx,actorId,entry.id,"POSTED",{journalNumber});
  return result(updated);
}
export async function executeJournalCommand(db: PrismaClient, actorId: string, rawOperation: unknown, raw: unknown, dependencies: JournalDependencies = {}): Promise<CommandResult> {
  const operation = z.enum(journalOperations).parse(rawOperation);
  const now = dependencies.now ?? (() => new Date());
  const number = dependencies.number ?? newJournalNumber;
  if (operation === "CREATE") {
    const input = createJournalSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const date = asDate(input.date), year = await openYear(tx, date);
      await accounts(tx, input.lines);
      const entry = await tx.journalEntry.create({ data: { journalNumber: await reserve(tx, now, number, input.journalNumber), date,
        description: input.description, fiscalYearId: year.id, createdById: actorId } });
      await writeLines(tx, entry.id, input.lines);
      const posted = await tx.journalEntry.update({where:{id:entry.id},data:{status:"POSTED",postingStatus:"POSTED",postedAt:now(),postedById:actorId,version:{increment:1}}});
      await audit(tx, actorId, entry.id, "POSTED", { journalNumber: entry.journalNumber, date: input.date, lines: input.lines });
      return result(posted);
    });
  }
  if (operation === "UPDATE") {
    const input = editOpeningJournalSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const entry = await lockedEntry(tx, input.id, input.version);
      if (entry.sourceType !== "MANUAL") throw new JournalError("Ubah jurnal otomatis bersama transaksi asalnya melalui formulir pengeditan transaksi.");
      const opening = await tx.openingJournal.findUnique({where:{journalEntryId:entry.id}});
      if (!opening?.perAccount) editJournalSchema.parse(input);
      return updatePostedJournal(tx, actorId, entry, input, dependencies);
    });
  }
  if (operation === "DELETE") {
    const input = deleteJournalSchema.parse(raw);
    return command(db, actorId, operation, input.requestKey, input, async tx => {
      const entry = await lockedEntry(tx, input.id, input.version);
      const openingJournal = await tx.openingJournal.findUnique({ where: { journalEntryId: entry.id }, select: { id: true } });
      const blocked = journalDeletionBlock({ ...entry, openingJournal });
      if (blocked) throw new JournalError(blocked);
      await openYear(tx, entry.date, true);
      const [transaction] = await tx.$queryRaw<{ id: string }[]>`SELECT txid_current()::text AS id`;
      await audit(tx, actorId, entry.id, "DELETED", {
        transactionId: transaction.id, reason: input.reason, before: journalSnapshot(entry),
        status: entry.status, postingStatus: entry.postingStatus, fiscalYearId: entry.fiscalYearId,
      });
      // Lines cascade; number reservations, account usage and audits remain intact.
      await tx.journalEntry.delete({ where: { id: entry.id, version: entry.version } });
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
