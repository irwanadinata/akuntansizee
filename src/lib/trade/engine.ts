import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client";
import { asDate } from "../accounting/dates";
import { accounts, audit, openYear, reserve, reverseInTransaction, writeLines, type JournalDependencies } from "../journal/engine";
import { boundedCommand, newJournalNumber, newPublicNumber, payloadHash } from "../journal/identity";
import { assertBalanced, type JournalLineInput } from "../journal/validation";
import { tradeBalance, type TradeTx } from "./balances";
import { createDocumentSchema, createPaymentSchema, reverseTradeSchema, tradeKinds, counterAccountAllowed,
  TRADE_CONTROL_CODES, TRADE_PREFIXES, TradeError, type TradeKind, type TradePrefix } from "./validation";

export const tradeOperations = ["CREATE_DOCUMENT", "CREATE_PAYMENT", "REVERSE_DOCUMENT", "REVERSE_PAYMENT"] as const;
export type TradeOperation = typeof tradeOperations[number];
export type TradeDependencies = JournalDependencies & { publicNumber?: (prefix: TradePrefix, date: Date) => string };
const resultSchema = z.object({ id: z.uuid(), documentId: z.uuid(), number: z.string(), journalId: z.uuid(), journalNumber: z.string(), reversed: z.boolean() });
export type TradeResult = z.infer<typeof resultSchema>;

async function controlAccount(tx: TradeTx, kind: TradeKind) {
  const control = await tx.account.findUnique({ where: { code: TRADE_CONTROL_CODES[kind] } });
  const receivable = kind === "RECEIVABLE";
  if (!control || !control.isControlAccount || control.isContra || control.mainType !== (receivable ? "ASSET" : "LIABILITY") ||
    control.reportGroup !== (receivable ? "RECEIVABLE" : "CURRENT_LIABILITY") || control.normalBalance !== (receivable ? "DEBIT" : "CREDIT")) {
    throw new TradeError("Akun kontrol " + (receivable ? "Piutang Usaha" : "Utang Usaha") + " belum tersedia atau tidak sesuai mapping yang disahkan. Periksa COA; akun tidak dibuat otomatis.");
  }
  return control;
}
async function counterAccount(tx: TradeTx, kind: TradeKind, id: string) {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account || !counterAccountAllowed(kind, account)) throw new TradeError(kind === "RECEIVABLE" ?
    "Pilih akun pendapatan normal kredit, bukan kontra atau akun kontrol." :
    "Pilih akun Beban, HPP atau Aset normal debit. Kas/Bank, kontra dan akun kontrol tidak dapat dipakai sebagai kategori tagihan supplier.");
}
async function cashAccount(tx: TradeTx, id: string) {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account || account.mainType !== "ASSET" || account.reportGroup !== "CASH_BANK" || account.normalBalance !== "DEBIT" || account.isContra || account.isControlAccount)
    throw new TradeError("Pilih akun Kas/Bank yang benar untuk pembayaran.");
}
function transactionNumber(prefix: TradePrefix, deps: TradeDependencies) {
  const number = (deps.publicNumber ?? newPublicNumber)(prefix, (deps.now ?? (() => new Date()))());
  if (!new RegExp("^" + prefix + "-\\d{8}-[A-Z0-9]{12}$").test(number)) throw new TradeError("Format nomor transaksi server tidak sah.");
  return number;
}
async function lockedDocument(tx: TradeTx, kind: TradeKind, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "TradeDocument" WHERE "id"=${id}::uuid AND "kind"=${kind}::"TradeKind" FOR UPDATE`;
  const document = await tx.tradeDocument.findUnique({ where: { id }, include: { journalEntry: true } });
  if (!document || document.kind !== kind) throw new TradeError("Tagihan tidak ditemukan pada modul ini.");
  if (document.reversalEntryId) throw new TradeError("Tagihan telah dibatalkan dan tidak menerima pembayaran atau perubahan baru.");
  return document;
}
async function checkTimeline(tx: TradeTx, id: string) {
  const balance = await tradeBalance(tx, id);
  if (BigInt(balance.minimum) < 0n || BigInt(balance.remaining) < 0n)
    throw new TradeError("Tanggal/nominal pembayaran membuat sisa historis negatif. Periksa tanggal pembayaran dan pembalik sebelumnya.");
  return balance;
}
async function automatic<T>(tx: TradeTx, actorId: string, kind: TradeKind,
  input: { date: Date; description: string; controlId: string; otherAccountId: string; lines: JournalLineInput[]; source: "TRADE_DOCUMENT" | "TRADE_PAYMENT" },
  deps: TradeDependencies, link: (entry: { id: string; journalNumber: string }) => Promise<T>) {
  const year = await openYear(tx, input.date);
  assertBalanced(input.lines);
  await accounts(tx, input.lines, false, input.controlId);
  // Classification is re-read while account row locks are held, including on first use.
  if ((await controlAccount(tx, kind)).id !== input.controlId) throw new TradeError("Akun kontrol berubah. Muat ulang sebelum melanjutkan.");
  if (input.source === "TRADE_DOCUMENT") await counterAccount(tx, kind, input.otherAccountId);
  else await cashAccount(tx, input.otherAccountId);
  const now = deps.now ?? (() => new Date());
  const entry = await tx.journalEntry.create({ data: { date: input.date, description: input.description, fiscalYearId: year.id,
    sourceType: input.source, createdById: actorId, journalNumber: await reserve(tx, now, deps.number ?? newJournalNumber) } });
  const linked = await link(entry);
  await writeLines(tx, entry.id, input.lines);
  await tx.journalEntry.update({ where: { id: entry.id }, data: { status: "POSTED", postingStatus: "POSTED", postedAt: now(), postedById: actorId, version: { increment: 1 } } });
  await audit(tx, actorId, entry.id, "POSTED", { source: input.source, kind, journalNumber: entry.journalNumber });
  return { entry, linked };
}

export async function executeTradeCommand(db: PrismaClient, actorId: string, kind: TradeKind, operation: TradeOperation, raw: unknown, deps: TradeDependencies = {}): Promise<TradeResult> {
  z.enum(tradeKinds).parse(kind); z.enum(tradeOperations).parse(operation);
  const input = operation === "CREATE_DOCUMENT" ? createDocumentSchema(kind).parse(raw) : operation === "CREATE_PAYMENT" ? createPaymentSchema.parse(raw) : reverseTradeSchema.parse(raw);
  const requestOperation = kind + ":" + operation, fingerprint = payloadHash(input);
  return boundedCommand(() => db.$transaction(async tx => {
    const scope = "TRADE:" + actorId + ":" + requestOperation + ":" + input.requestKey;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))::text`;
    const prior = await tx.tradeRequest.findUnique({ where: { actorId_operation_requestKey: { actorId, operation: requestOperation, requestKey: input.requestKey } } });
    if (prior) {
      if (prior.payloadHash !== fingerprint) throw new TradeError("Kunci permintaan sama membawa isi berbeda. Kirim sebagai tindakan baru.");
      return resultSchema.parse(prior.result);
    }
    const result = await work(tx);
    await tx.tradeRequest.create({ data: { actorId, operation: requestOperation, requestKey: input.requestKey, payloadHash: fingerprint, result } });
    return result;
  }, { timeout: 30000, maxWait: 10000 }));

  async function work(tx: TradeTx): Promise<TradeResult> {
    const stamp = (deps.now ?? (() => new Date()))(), effectiveDeps = { ...deps, now: () => stamp };
    const receivable = kind === "RECEIVABLE";
    if (operation === "CREATE_DOCUMENT") {
      const value = createDocumentSchema(kind).parse(input), control = await controlAccount(tx, kind);
      const number = transactionNumber(TRADE_PREFIXES[kind].document, effectiveDeps);
      const debitAccount = receivable ? control.id : value.counterAccountId, creditAccount = receivable ? value.counterAccountId : control.id;
      const { entry, linked: document } = await automatic(tx, actorId, kind, {
        date: asDate(value.date), description: "Tagihan " + (receivable ? "customer " : "supplier ") + value.partyName + " · " + number,
        controlId: control.id, otherAccountId: value.counterAccountId, source: "TRADE_DOCUMENT",
        lines: [{ accountId: debitAccount, debit: value.amount, credit: "0", description: "Tagihan" }, { accountId: creditAccount, debit: "0", credit: value.amount, description: "Tagihan" }],
      }, effectiveDeps, entry => tx.tradeDocument.create({ data: { kind, documentNumber: number, partyName: value.partyName, date: asDate(value.date), amount: value.amount,
        dueDate: value.dueDate ? asDate(value.dueDate) : null, externalReference: value.externalReference || null, notes: value.notes || null,
        controlAccountId: control.id, counterAccountId: value.counterAccountId, journalEntryId: entry.id, createdById: actorId } }));
      await audit(tx, actorId, document.id, "CREATED", { kind, number, partyName: value.partyName, amount: value.amount, externalReference: value.externalReference, journalId: entry.id }, "TRADE_DOCUMENT");
      return { id: document.id, documentId: document.id, number, journalId: entry.id, journalNumber: entry.journalNumber, reversed: false };
    }
    if (operation === "CREATE_PAYMENT") {
      const value = createPaymentSchema.parse(input), document = await lockedDocument(tx, kind, value.documentId), date = asDate(value.date);
      if (date < document.date) throw new TradeError("Tanggal pembayaran tidak boleh mendahului tanggal tagihan.");
      const balance = await tradeBalance(tx, document.id);
      if (BigInt(value.amount) > BigInt(balance.remaining)) throw new TradeError("Pembayaran melebihi sisa tagihan. Muat ulang untuk melihat sisa terbaru.");
      const number = transactionNumber(TRADE_PREFIXES[kind].payment, effectiveDeps);
      const debitAccount = receivable ? value.cashAccountId : document.controlAccountId, creditAccount = receivable ? document.controlAccountId : value.cashAccountId;
      const { entry, linked: payment } = await automatic(tx, actorId, kind, {
        date, description: "Pembayaran " + document.partyName + " · " + number + " / " + document.documentNumber,
        controlId: document.controlAccountId, otherAccountId: value.cashAccountId, source: "TRADE_PAYMENT",
        lines: [{ accountId: debitAccount, debit: value.amount, credit: "0", description: receivable ? "Pembayaran diterima" : "Pembayaran supplier" },
          { accountId: creditAccount, debit: "0", credit: value.amount, description: "Mengurangi sisa tagihan" }],
      }, effectiveDeps, entry => tx.tradePayment.create({ data: { documentId: document.id, paymentNumber: number, date, amount: value.amount,
        cashAccountId: value.cashAccountId, notes: value.notes || null, journalEntryId: entry.id, createdById: actorId } }));
      await tx.tradeDocument.update({ where: { id: document.id }, data: { version: { increment: 1 } } });
      await checkTimeline(tx, document.id);
      await audit(tx, actorId, payment.id, "CREATED", { kind, number, documentId: document.id, amount: value.amount, journalId: entry.id }, "TRADE_PAYMENT");
      return { id: payment.id, documentId: document.id, number, journalId: entry.id, journalNumber: entry.journalNumber, reversed: false };
    }
    const value = reverseTradeSchema.parse(input);
    const payment = operation === "REVERSE_PAYMENT" ? await tx.tradePayment.findUnique({ where: { id: value.id }, include: { document: { select: { kind: true } } } }) : null;
    if (operation === "REVERSE_PAYMENT" && (!payment || payment.document.kind !== kind)) throw new TradeError("Pembayaran tidak ditemukan pada modul ini.");
    const document = await lockedDocument(tx, kind, payment ? payment.documentId : value.id);
    const target = payment ? await tx.tradePayment.findUniqueOrThrow({ where: { id: payment.id }, include: { journalEntry: true } }) : document;
    if (target.reversalEntryId) throw new TradeError("Transaksi sudah dibatalkan.");
    const date = asDate(value.date);
    if (!payment) {
      const payments = await tx.tradePayment.findMany({ where: { documentId: document.id }, include: { reversalEntry: true } });
      if (payments.some(row => !row.reversalEntryId)) throw new TradeError("Batalkan seluruh pembayaran aktif terlebih dahulu sebelum membatalkan tagihan.");
      if (payments.some(row => row.date > date || (row.reversalEntry && row.reversalEntry.date > date)))
        throw new TradeError("Tanggal pembatalan tagihan harus pada/setelah seluruh pembayaran dan pembaliknya.");
    }
    const reversed = await reverseInTransaction(tx, actorId, { id: target.journalEntryId, version: target.journalEntry.version, date: value.date,
      reason: value.reason, requestKey: value.requestKey }, effectiveDeps, payment ? "TRADE_PAYMENT" : "TRADE_DOCUMENT", document.controlAccountId);
    const data = { reversalEntryId: reversed.id, reversalReason: value.reason, reversedAt: stamp, version: { increment: 1 } };
    if (payment) {
      await tx.tradePayment.update({ where: { id: payment.id }, data });
      await tx.tradeDocument.update({ where: { id: document.id }, data: { version: { increment: 1 } } });
    } else await tx.tradeDocument.update({ where: { id: document.id }, data });
    await checkTimeline(tx, document.id);
    const number = payment ? payment.paymentNumber : document.documentNumber;
    await audit(tx, actorId, target.id, "REVERSED", { kind, number, documentId: document.id, reversalId: reversed.id, reason: value.reason }, payment ? "TRADE_PAYMENT" : "TRADE_DOCUMENT");
    return { id: target.id, documentId: document.id, number, journalId: reversed.id, journalNumber: reversed.journalNumber!, reversed: true };
  }
}
