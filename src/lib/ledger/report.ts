import { referenceColumns,referenceJoins } from "../reports/references";
import { MAX_PDF_SOURCES } from "../reports/validation";
import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { asDate, dateString } from "../accounting/dates";
import { normalBalance } from "../accounting/money";
import { businessDate, JournalError } from "../journal/validation";
export const ledgerFilters = z.object({ accountId: z.uuid(), fiscalYearId: z.uuid().optional(), from: businessDate, to: businessDate,
  page: z.coerce.number().int().min(1).max(100000).default(1) }).strict().refine(input => input.from <= input.to, { message: "Tanggal awal melebihi tanggal akhir." });
type Row = { id: string; entryId: string; date: Date; journalNumber: string; description: string; debit: Prisma.Decimal; credit: Prisma.Decimal; running: Prisma.Decimal; businessNumber:string|null;parentNumber:string|null };
export async function ledgerReport(db: PrismaClient, raw: unknown, options:{exportAll?:boolean}={}) {
  const filter = ledgerFilters.parse(raw), from = asDate(filter.from), to = asDate(filter.to);
  return db.$transaction(async tx => {
    const account = await tx.account.findUnique({ where: { id: filter.accountId } });
    if (!account) throw new JournalError("Akun tidak ditemukan.");
    let selectedYear: {year:number;status:"OPEN"|"LOCKED"}|null=null;
    if (filter.fiscalYearId) {
      const year = await tx.fiscalYear.findUnique({ where: { id: filter.fiscalYearId } });
      if (!year || from < year.startDate || to > year.endDate) throw new JournalError("Rentang tanggal harus berada dalam tahun buku yang dipilih.");
      selectedYear={year:year.year,status:year.status};
    }
    // Opening includes all prior years. Lifecycle REVERSED remains economically POSTED;
    // its paired reversing journal affects balances only on the reversal's effective date.
    const opening = await tx.journalLine.aggregate({ where: { accountId: account.id, entry: { postingStatus: "POSTED", date: { lt: from } } }, _sum: { debit: true, credit: true } });
    const netOpening = BigInt(opening._sum.debit?.toFixed(0) ?? "0") - BigInt(opening._sum.credit?.toFixed(0) ?? "0");
    const where: Prisma.JournalLineWhereInput = { accountId: account.id, entry: { postingStatus: "POSTED", date: { gte: from, lte: to } } };
    const count = await tx.journalLine.count({ where }), pages = Math.max(1, Math.ceil(count / 50)), page = Math.min(filter.page, pages);
    if(options.exportAll&&count>MAX_PDF_SOURCES)throw new JournalError("Ekspor melebihi "+MAX_PDF_SOURCES+" baris. Persempit akun/periode agar PDF tidak dipotong.");
    const movement = await tx.journalLine.aggregate({ where, _sum: { debit: true, credit: true } });
    const debit = movement._sum.debit?.toFixed(0) ?? "0", credit = movement._sum.credit?.toFixed(0) ?? "0";
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT l."id", e."id" AS "entryId", e."date", e."journalNumber", e."description", l."debit", l."credit",${referenceColumns},
        SUM(l."debit"-l."credit") OVER (ORDER BY e."date",e."postedAt",e."id",l."lineNo" ROWS UNBOUNDED PRECEDING) AS "running"
      FROM "JournalLine" l JOIN "JournalEntry" e ON e."id"=l."entryId" ${referenceJoins}
      WHERE l."accountId"=${account.id}::uuid AND e."postingStatus"='POSTED' AND e."date">=${filter.from}::date AND e."date"<=${filter.to}::date
      ORDER BY e."date",e."postedAt",e."id",l."lineNo" LIMIT ${options.exportAll?MAX_PDF_SOURCES:50} OFFSET ${options.exportAll?0:(page - 1) * 50}`);
    const signed = (value: bigint) => normalBalance(value, account.normalBalance).toString();
    return { year:selectedYear, account: { id: account.id, code: account.code, name: account.name, normalBalance: account.normalBalance, isContra: account.isContra },
      opening: signed(netOpening), closing: signed(netOpening + BigInt(debit) - BigInt(credit)), debit, credit, count, page, pages,
      rows: rows.map(row => ({ id: row.id, entryId: row.entryId, date: dateString(row.date), journalNumber: row.journalNumber, businessNumber:row.businessNumber,parentNumber:row.parentNumber,description: row.description,
        debit: row.debit.toFixed(0), credit: row.credit.toFixed(0), balance: signed(netOpening + BigInt(row.running.toFixed(0))) })) };
  }, { isolationLevel: "RepeatableRead", timeout: 20000 });
}
