import { Prisma,type PrismaClient } from "../../generated/prisma/client";
import { z } from "zod";
import { asDate } from "../accounting/dates";
import { accounts,openYear,reserve,writeLines,audit,type JournalDependencies } from "../journal/engine";
import { boundedCommand,newJournalNumber,payloadHash } from "../journal/identity";
import { JournalError,totals } from "../journal/validation";
import { assertOpeningAccount,openingFields,openingLines,postOpeningSchema,type OpeningInput } from "./validation";
const resultSchema=z.object({id:z.uuid(),journalNumber:z.string(),openingId:z.uuid()});
export type OpeningResult=z.infer<typeof resultSchema>;
async function prepare(tx:Prisma.TransactionClient,input:OpeningInput){
  const year=await openYear(tx,asDate(input.cutoverDate));
  if(await tx.openingJournal.findUnique({where:{singletonKey:1}}))throw new JournalError("Saldo pembukaan sudah pernah dicatat. Impor ulang dengan tanggal atau kunci baru tetap ditolak; periksa jurnal pembukaan yang tersimpan.");
  if(year.id!==input.fiscalYearId)throw new JournalError("Tanggal cutover harus berada pada Tahun Buku aktif yang dipilih.");
  const lines=openingLines(input);await accounts(tx,lines);
  const rows=await tx.account.findMany({where:{id:{in:input.lines.map(line=>line.accountId)}},orderBy:{id:"asc"}});
  rows.forEach(assertOpeningAccount);
  if(await tx.journalEntry.count({where:{postingStatus:"POSTED",date:{lt:asDate(input.cutoverDate)}}}))throw new JournalError("Sudah ada jurnal terposting sebelum cutover. Tanggal pembukaan tidak boleh menimpa periode yang sudah dibukukan; verifikasi tanggal dan cakupan saldo terlebih dahulu.");
  const previewHash=payloadHash({input,year:{id:year.id,version:year.version},accounts:rows.map(row=>({id:row.id,code:row.code,name:row.name,version:row.version,reviewedAt:row.reviewedAt?.toISOString()}))});
  const total=totals(lines);
  return{year,lines,previewHash,total,rows};
}
export async function previewOpening(db:PrismaClient,raw:unknown){
  const input=openingFields.parse(raw);
  return db.$transaction(async tx=>{
    const data=await prepare(tx,input);
    return{input,previewHash:data.previewHash,year:data.year.year,totalDebit:data.total.debit.toString(),totalCredit:data.total.credit.toString(),lines:input.lines.map(line=>{const account=data.rows.find(row=>row.id===line.accountId)!;return{...line,code:account.code,name:account.name};})};
  },{timeout:20000});
}
export type OpeningPreview=Awaited<ReturnType<typeof previewOpening>>;
export async function postOpening(db:PrismaClient,actorId:string,raw:unknown,dependencies:JournalDependencies={}):Promise<OpeningResult>{
  const parsed=postOpeningSchema.parse(raw),{requestKey,previewHash,confirmed,...input}=parsed;
  const fingerprint=payloadHash({input,previewHash,confirmed}),now=dependencies.now??(()=>new Date()),number=dependencies.number??newJournalNumber;
  return boundedCommand(()=>db.$transaction(async tx=>{
    // One initialization across all request keys, dates and fiscal years.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('zee:opening-cutover', 0))::text`;
    const existing=await tx.journalRequest.findUnique({where:{actorId_operation_requestKey:{actorId,operation:"POST_OPENING",requestKey}}});
    if(existing){if(existing.payloadHash!==fingerprint)throw new JournalError("Kunci permintaan sama membawa isi berbeda. Tidak ada jurnal pembukaan baru dibuat.");return resultSchema.parse(existing.result);}
    const data=await prepare(tx,input);
    if(data.previewHash!==previewHash)throw new JournalError("Isi, akun atau status tahun berubah setelah preview. Periksa ulang preview sebelum menyimpan.");
    const entry=await tx.journalEntry.create({data:{journalNumber:await reserve(tx,now,number),date:asDate(input.cutoverDate),description:"Saldo pembukaan terverifikasi: "+input.verificationNote,fiscalYearId:data.year.id,createdById:actorId}});
    await writeLines(tx,entry.id,data.lines);
    const marker=await tx.openingJournal.create({data:{journalEntryId:entry.id,cutoverDate:entry.date,fiscalYearId:data.year.id,verificationNote:input.verificationNote,previewHash,createdById:actorId,confirmedAt:now()}});
    await tx.journalEntry.update({where:{id:entry.id},data:{status:"POSTED",postingStatus:"POSTED",postedAt:now(),postedById:actorId,version:{increment:1}}});
    await audit(tx,actorId,entry.id,"POSTED",{journalNumber:entry.journalNumber,openingId:marker.id,cutoverDate:input.cutoverDate,verificationNote:input.verificationNote,previewHash,confirmed:true,lines:data.lines});
    await audit(tx,actorId,marker.id,"OPENING_POSTED",{journalEntryId:entry.id,journalNumber:entry.journalNumber,cutoverDate:input.cutoverDate,verificationNote:input.verificationNote,previewHash,confirmed:true},"OPENING");
    const output={id:entry.id,journalNumber:entry.journalNumber,openingId:marker.id};
    await tx.journalRequest.create({data:{actorId,operation:"POST_OPENING",requestKey,payloadHash:fingerprint,result:output}});
    return output;
  },{timeout:20000,maxWait:10000}));
}
