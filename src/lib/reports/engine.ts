import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { asDate,dateString } from "../accounting/dates";
import { loanMovements } from "../loans/balances";
import { tradeMovements } from "../trade/balances";
import { calculateStatements,type AccountTotals } from "./calculation";
import { reportFilters,ReportError,MAX_PDF_SOURCES,type ReportType } from "./validation";
import { referenceColumns,referenceJoins } from "./references";
type AggregateRow=Omit<AccountTotals,"cumulative"|"prior"|"yearToDate"|"period"|"reviewed">&{reviewedAt:Date|null;cumulative:Prisma.Decimal;prior:Prisma.Decimal;yearToDate:Prisma.Decimal;period:Prisma.Decimal};
type SourceRow={id:string;date:Date;postedAt:Date;journalNumber:string;description:string;businessNumber:string|null;parentNumber:string|null;debit:Prisma.Decimal;credit:Prisma.Decimal};
export type ReportSource={id:string;date:string;postedAt:string;journalNumber:string;description:string;businessNumber:string|null;parentNumber:string|null;debit:string;credit:string};
export async function financialReport(db:PrismaClient,raw:unknown,options:{type?:ReportType;sourcePage?:number;exportAll?:boolean;component?:"prior"|"current"}={}) {
  const filter=reportFilters.parse(raw),yearStart=filter.year+"-01-01";
  return db.$transaction(async tx=>{
    const fiscal=await tx.fiscalYear.findUnique({where:{year:filter.year}});
    if(!fiscal)throw new ReportError("Tahun buku belum dibuat. Tambahkan melalui menu Tahun Buku.");
    if(asDate(filter.from)<fiscal.startDate||asDate(filter.to)>fiscal.endDate)throw new ReportError("Tanggal berada di luar tahun buku yang dipilih.");
    const aggregates=await tx.$queryRaw<AggregateRow[]>(Prisma.sql`
      WITH posted AS(SELECT l."accountId",l."debit",l."credit",e."date" FROM "JournalLine" l JOIN "JournalEntry" e ON e."id"=l."entryId" WHERE e."postingStatus"='POSTED' AND e."date"<=${filter.to}::date)
      SELECT a."id",a."code",a."name",a."mainType",a."reportGroup",a."normalBalance",a."isContra",a."isControlAccount",a."requiresReview",a."reviewedAt",COUNT(p."accountId")>0 AS "hasPosted",
      COALESCE(SUM(p."debit"-p."credit"),0) AS cumulative,
      COALESCE(SUM(p."debit"-p."credit") FILTER(WHERE p."date"<${yearStart}::date),0) AS prior,
      COALESCE(SUM(p."debit"-p."credit") FILTER(WHERE p."date">=${yearStart}::date),0) AS "yearToDate",
      COALESCE(SUM(p."debit"-p."credit") FILTER(WHERE p."date">=${filter.from}::date),0) AS period
      FROM "Account" a LEFT JOIN posted p ON p."accountId"=a."id" GROUP BY a."id" ORDER BY a."code",a."id"`);
    const accounts:AccountTotals[]=aggregates.map(row=>({...row,reviewed:Boolean(row.reviewedAt),cumulative:row.cumulative.toFixed(0),prior:row.prior.toFixed(0),yearToDate:row.yearToDate.toFixed(0),period:row.period.toFixed(0)}));
    const statements=calculateStatements(accounts);
    const [trial]=await tx.$queryRaw<{debit:Prisma.Decimal;credit:Prisma.Decimal}[]>(Prisma.sql`SELECT COALESCE(SUM(l."debit"),0) AS debit,COALESCE(SUM(l."credit"),0) AS credit FROM "JournalLine" l JOIN "JournalEntry" e ON e."id"=l."entryId" WHERE e."postingStatus"='POSTED' AND e."date"<=${filter.to}::date`);
    const invalidJournals=await tx.$queryRaw<{id:string;journalNumber:string}[]>(Prisma.sql`SELECT e."id",e."journalNumber" FROM "JournalEntry" e LEFT JOIN "JournalLine" l ON l."entryId"=e."id" WHERE e."postingStatus"='POSTED' AND e."date"<=${filter.to}::date GROUP BY e."id" HAVING COUNT(l."id")<2 OR COALESCE(SUM(l."debit"),0)<=0 OR SUM(l."debit")<>SUM(l."credit") OR BOOL_OR(NOT((l."debit">0 AND l."credit"=0)OR(l."credit">0 AND l."debit"=0))) ORDER BY e."date",e."postedAt",e."id" LIMIT 20`);
    const controls=await tx.$queryRaw<{code:string;name:string;detail:Prisma.Decimal;control:Prisma.Decimal}[]>(Prisma.sql`
      WITH lm AS(${loanMovements}),tm AS(${tradeMovements}),expected AS(
        SELECT '1122.1' AS code,'Piutang Karyawan' AS name,(SELECT COALESCE(SUM(net),0) FROM lm WHERE "date"<=${filter.to}::date) AS detail
        UNION ALL SELECT '1121.1','Piutang Usaha',(SELECT COALESCE(SUM(net),0) FROM tm WHERE "kind"='RECEIVABLE' AND "date"<=${filter.to}::date)
        UNION ALL SELECT '2110.1','Utang Usaha',(SELECT COALESCE(SUM(net),0) FROM tm WHERE "kind"='PAYABLE' AND "date"<=${filter.to}::date))
      SELECT x.code,x.name,x.detail,COALESCE((SELECT SUM(CASE WHEN x.code='2110.1' THEN l."credit"-l."debit" ELSE l."debit"-l."credit" END) FROM "JournalLine" l JOIN "JournalEntry" e ON e."id"=l."entryId" JOIN "Account" a ON a."id"=l."accountId" WHERE a."code"=x.code AND e."postingStatus"='POSTED' AND e."date"<=${filter.to}::date),0) AS control FROM expected x`);
    const reconciliations=controls.map(row=>({code:row.code,name:row.name,detail:row.detail.toFixed(0),control:row.control.toFixed(0),difference:(BigInt(row.control.toFixed(0))-BigInt(row.detail.toFixed(0))).toString()}));
    const [closing]=await tx.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) AS count FROM(SELECT e."id" FROM "JournalEntry" e JOIN "JournalLine" l ON l."entryId"=e."id" JOIN "Account" a ON a."id"=l."accountId" WHERE e."postingStatus"='POSTED' AND e."sourceType" IN('MANUAL','REVERSAL') AND e."date">=${filter.from}::date AND e."date"<=${filter.to}::date GROUP BY e."id" HAVING BOOL_OR(a."reportGroup"='RETAINED_EARNINGS') AND BOOL_OR(a."mainType" IN('REVENUE','COGS','EXPENSE','OTHER_RESULT'))) q`);
    const warnings=[...statements.mappingWarnings];
    if(statements.balance.difference!=="0")warnings.push("Neraca tidak seimbang. Periksa klasifikasi dan jurnal; tidak ada penyeimbang otomatis.");
    const trialDifference=(BigInt(trial.debit.toFixed(0))-BigInt(trial.credit.toFixed(0))).toString();
    if(trialDifference!=="0"||invalidJournals.length)warnings.push("Ada ketidaksesuaian debit/kredit atau bentuk jurnal terposting. Laporan perlu diperiksa.");
    if(reconciliations.some(row=>row.difference!=="0"))warnings.push("Saldo akun kontrol berbeda dengan rincian subledger.");
    if(closing.count>0n)warnings.push("Ada jurnal manual antara laba ditahan dan akun hasil usaha pada rentang ini. Periksa penutupan manual: laba rugi mengikuti tanggal dan seluruh jurnal terposting, tanpa menebak atau mengecualikan jurnal penutup.");
    const sourceRange=options.component?Prisma.sql`AND e."date" ${options.component==="prior"?Prisma.sql`<${yearStart}::date`:Prisma.sql`>=${yearStart}::date`} AND EXISTS(SELECT 1 FROM "JournalLine" sl JOIN "Account" sa ON sa."id"=sl."accountId" WHERE sl."entryId"=e."id" AND sa."mainType" IN ('REVENUE','COGS','EXPENSE','OTHER_RESULT'))`:options.type==="profit"?Prisma.sql`AND e."date">=${filter.from}::date`:Prisma.empty;
    const [sourceCount]=await tx.$queryRaw<{count:bigint}[]>(Prisma.sql`SELECT COUNT(*) AS count FROM "JournalEntry" e WHERE e."postingStatus"='POSTED' AND e."date"<=${filter.to}::date ${sourceRange}`);
    const count=Number(sourceCount.count),pages=Math.max(1,Math.ceil(count/50)),page=Math.max(1,Math.min(options.sourcePage??1,pages));
    if(options.exportAll&&count>MAX_PDF_SOURCES)throw new ReportError("Lebih dari "+MAX_PDF_SOURCES+" jurnal sumber. Ekspor lengkap ini terlalu besar; gunakan cetak halaman atau Buku Besar dengan filter akun/periode yang lebih sempit.");
    const sourceRows=await tx.$queryRaw<SourceRow[]>(Prisma.sql`SELECT e."id",e."date",e."postedAt",e."journalNumber",e."description",${referenceColumns},s.debit,s.credit FROM "JournalEntry" e ${referenceJoins}
      JOIN LATERAL(SELECT COALESCE(SUM(l."debit"),0) AS debit,COALESCE(SUM(l."credit"),0) AS credit FROM "JournalLine" l WHERE l."entryId"=e."id")s ON TRUE
      WHERE e."postingStatus"='POSTED' AND e."date"<=${filter.to}::date ${sourceRange} ORDER BY e."date",e."postedAt",e."id" LIMIT ${options.exportAll?MAX_PDF_SOURCES:50} OFFSET ${options.exportAll?0:(page-1)*50}`);
    const sources:ReportSource[]=sourceRows.map(row=>({...row,date:dateString(row.date),postedAt:row.postedAt.toISOString(),debit:row.debit.toFixed(0),credit:row.credit.toFixed(0)}));
    return {filter,year:{id:fiscal.id,year:fiscal.year,status:fiscal.status},...statements,accounts,
      diagnostics:{warnings,canUse:!warnings.length,trialDebit:trial.debit.toFixed(0),trialCredit:trial.credit.toFixed(0),trialDifference,invalidJournals,reconciliations,manualClosingCount:Number(closing.count)},
      sources,sourceCount:count,sourcePage:page,sourcePages:pages,sourceScope:options.component??(options.type==="profit"?"period" as const:"cumulative" as const),generatedAt:new Date().toISOString()};
  },{isolationLevel:"RepeatableRead",timeout:30000});
}
export type FinancialReport=Awaited<ReturnType<typeof financialReport>>;
