// Creates a historical unposted record for compatibility tests only.
import type {PrismaClient} from "../../src/generated/prisma/client";
import {accounts,audit,openYear,reserve,writeLines,type CommandResult} from "../../src/lib/journal/engine";
import {asDate} from "../../src/lib/accounting/dates";
import {newJournalNumber} from "../../src/lib/journal/identity";
import type {JournalLineInput} from "../../src/lib/journal/validation";
export async function seedLegacyUnposted(db:PrismaClient,actorId:string,date:string,lines:Omit<JournalLineInput,"description">[]):Promise<CommandResult>{
 return db.$transaction(async tx=>{const entries=lines.map(line=>({...line,description:""})),fiscal=await openYear(tx,asDate(date),true);await accounts(tx,entries);
 const row=await tx.journalEntry.create({data:{journalNumber:await reserve(tx,()=>new Date(),newJournalNumber),date:asDate(date),description:"Catatan lama belum diposting",fiscalYearId:fiscal.id,createdById:actorId}});
 await writeLines(tx,row.id,entries);await audit(tx,actorId,row.id,"CREATED",{journalNumber:row.journalNumber});return{id:row.id,journalNumber:row.journalNumber,status:row.status,version:row.version,entity:"JOURNAL"};});
}
