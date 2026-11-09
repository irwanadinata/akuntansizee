import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { asDate } from "../accounting/dates";
import { audit, updatePostedJournal, type CommandResult, type JournalDependencies } from "./engine";
import { boundedCommand, payloadHash } from "./identity";
import { JournalError, type JournalLineInput } from "./validation";
import { sourceEditSchema } from "./source-validation";
import { counterAccountAllowed } from "../trade/validation";
import { loanBalance } from "../loans/balances";
import { tradeBalance } from "../trade/balances";

async function cashAccount(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.account.findUnique({where:{id}});
  if (!row || row.mainType!=="ASSET" || row.reportGroup!=="CASH_BANK" || row.normalBalance!=="DEBIT" || row.isContra || row.isControlAccount)
    throw new JournalError("Pilih akun Kas/Bank yang sah.");
}
export async function executeSourceJournalUpdate(db: PrismaClient, actorId: string, raw: unknown, dependencies: JournalDependencies = {}): Promise<CommandResult> {
  const value=sourceEditSchema.parse(raw), fingerprint=payloadHash(value), operation="UPDATE_SOURCE";
  return boundedCommand(()=>db.$transaction(async tx=>{
    const scope=actorId+":"+operation+":"+value.requestKey;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope},0))::text`;
    const prior=await tx.journalRequest.findUnique({where:{actorId_operation_requestKey:{actorId,operation,requestKey:value.requestKey}}});
    if(prior){if(prior.payloadHash!==fingerprint)throw new JournalError("Permintaan yang sama membawa isi berbeda. Muat ulang sebelum menyimpan.");return prior.result as CommandResult;}
    // Lock the owning parent first, matching payment creation and serializing edits with new payments.
    const owner = value.sourceType==="LOAN" ? await tx.loan.findUnique({where:{journalEntryId:value.id}}) :
      value.sourceType==="LOAN_PAYMENT" ? await tx.loanPayment.findUnique({where:{journalEntryId:value.id}}) :
      value.sourceType==="TRADE_DOCUMENT" ? await tx.tradeDocument.findUnique({where:{journalEntryId:value.id}}) :
      await tx.tradePayment.findUnique({where:{journalEntryId:value.id}});
    if(!owner)throw new JournalError("Transaksi asal jurnal tidak ditemukan.");
    if(value.sourceType==="LOAN" || value.sourceType==="LOAN_PAYMENT") {
      const parentId="loanId" in owner ? owner.loanId : owner.id;
      await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id"=${parentId}::uuid FOR UPDATE`;
    } else {
      const parentId="documentId" in owner ? owner.documentId : owner.id;
      await tx.$queryRaw`SELECT "id" FROM "TradeDocument" WHERE "id"=${parentId}::uuid FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT "id" FROM "JournalEntry" WHERE "id"=${value.id}::uuid FOR UPDATE`;
    const entry=await tx.journalEntry.findUniqueOrThrow({where:{id:value.id},include:{lines:{orderBy:{lineNo:"asc"}}}});
    if(entry.version!==value.version || entry.sourceType!==value.sourceType)throw new JournalError("Jurnal sudah berubah. Muat ulang sebelum mengedit.");
    const date=asDate(value.date);
    let lines:JournalLineInput[], description:string, allowedControlId:string, sourceId:string, entity:string;
    let before:unknown, after:unknown, updateSource:()=>Promise<void>, checkBalance:()=>Promise<{minimum:string;remaining:string}>;
    if(value.sourceType==="LOAN") {
      const loan=await tx.loan.findUniqueOrThrow({where:{journalEntryId:entry.id}});
      if(loan.reversalEntryId || loan.version!==value.sourceVersion)throw new JournalError("Pinjaman sudah berubah atau pernah dibatalkan. Muat ulang halaman.");
      if(await tx.loanPayment.findFirst({where:{loanId:loan.id,date:{lt:date}}}))throw new JournalError("Tanggal pinjaman tidak boleh setelah cicilan yang sudah dicatat.");
      await cashAccount(tx,value.cashAccountId);allowedControlId=loan.controlAccountId;sourceId=loan.id;entity="LOAN";
      const data={employeeName:value.employeeName,date,amount:value.amount,cashAccountId:value.cashAccountId,notes:value.notes||null,dueDate:value.dueDate?asDate(value.dueDate):null};
      before=loan;after=data;description="Pinjaman "+value.employeeName+" · "+loan.loanNumber;
      lines=[{accountId:allowedControlId,debit:value.amount,credit:"0",description:"Pinjaman karyawan"},{accountId:value.cashAccountId,debit:"0",credit:value.amount,description:"Uang dikeluarkan"}];
      updateSource=async()=>{await tx.loan.update({where:{id:loan.id,version:value.sourceVersion},data:{...data,version:{increment:1}}});};
      checkBalance=()=>loanBalance(tx,loan.id);
    } else if(value.sourceType==="LOAN_PAYMENT") {
      const payment=await tx.loanPayment.findUniqueOrThrow({where:{journalEntryId:entry.id},include:{loan:true}}),loan=payment.loan;
      if(payment.reversalEntryId || loan.reversalEntryId || payment.version!==value.sourceVersion || loan.version!==value.parentVersion)throw new JournalError("Pinjaman atau cicilan sudah berubah. Muat ulang halaman.");
      if(date<loan.date)throw new JournalError("Tanggal cicilan tidak boleh mendahului tanggal pinjaman.");
      await cashAccount(tx,value.cashAccountId);allowedControlId=loan.controlAccountId;sourceId=payment.id;entity="LOAN_PAYMENT";
      const data={date,amount:value.amount,cashAccountId:value.cashAccountId,notes:value.notes||null};
      before=payment;after=data;description="Cicilan "+loan.employeeName+" · "+payment.paymentNumber+" / "+loan.loanNumber;
      lines=[{accountId:value.cashAccountId,debit:value.amount,credit:"0",description:"Cicilan diterima"},{accountId:allowedControlId,debit:"0",credit:value.amount,description:"Mengurangi pinjaman"}];
      updateSource=async()=>{await tx.loanPayment.update({where:{id:payment.id,version:value.sourceVersion},data:{...data,version:{increment:1}}});await tx.loan.update({where:{id:loan.id},data:{version:{increment:1}}});};
      checkBalance=()=>loanBalance(tx,loan.id);
    } else if(value.sourceType==="TRADE_DOCUMENT") {
      const document=await tx.tradeDocument.findUniqueOrThrow({where:{journalEntryId:entry.id}});
      if(document.kind!==value.kind || document.reversalEntryId || document.version!==value.sourceVersion)throw new JournalError("Tagihan sudah berubah atau pernah dibatalkan. Muat ulang halaman.");
      if(await tx.tradePayment.findFirst({where:{documentId:document.id,date:{lt:date}}}))throw new JournalError("Tanggal tagihan tidak boleh setelah pembayaran yang sudah dicatat.");
      const counter=await tx.account.findUnique({where:{id:value.counterAccountId}});
      if(!counter || !counterAccountAllowed(document.kind,counter))throw new JournalError("Pilih akun pendapatan atau kategori pengeluaran yang sesuai jenis tagihan.");
      allowedControlId=document.controlAccountId;sourceId=document.id;entity="TRADE_DOCUMENT";
      const data={partyName:value.partyName,date,amount:value.amount,counterAccountId:value.counterAccountId,notes:value.notes||null,dueDate:value.dueDate?asDate(value.dueDate):null,externalReference:value.externalReference||null};
      before=document;after=data;description="Tagihan "+(document.kind==="RECEIVABLE"?"customer ":"supplier ")+value.partyName+" · "+document.documentNumber;
      const receivable=document.kind==="RECEIVABLE";
      lines=[{accountId:receivable?allowedControlId:value.counterAccountId,debit:value.amount,credit:"0",description:"Tagihan"},{accountId:receivable?value.counterAccountId:allowedControlId,debit:"0",credit:value.amount,description:"Tagihan"}];
      updateSource=async()=>{await tx.tradeDocument.update({where:{id:document.id,version:value.sourceVersion},data:{...data,version:{increment:1}}});};
      checkBalance=()=>tradeBalance(tx,document.id);
    } else {
      const payment=await tx.tradePayment.findUniqueOrThrow({where:{journalEntryId:entry.id},include:{document:true}}),document=payment.document;
      if(document.kind!==value.kind || payment.reversalEntryId || document.reversalEntryId || payment.version!==value.sourceVersion || document.version!==value.parentVersion)throw new JournalError("Tagihan atau pembayaran sudah berubah. Muat ulang halaman.");
      if(date<document.date)throw new JournalError("Tanggal pembayaran tidak boleh mendahului tanggal tagihan.");
      await cashAccount(tx,value.cashAccountId);allowedControlId=document.controlAccountId;sourceId=payment.id;entity="TRADE_PAYMENT";
      const data={date,amount:value.amount,cashAccountId:value.cashAccountId,notes:value.notes||null};
      before=payment;after=data;description="Pembayaran "+document.partyName+" · "+payment.paymentNumber+" / "+document.documentNumber;
      const receivable=document.kind==="RECEIVABLE";
      lines=[{accountId:receivable?value.cashAccountId:allowedControlId,debit:value.amount,credit:"0",description:receivable?"Pembayaran diterima":"Pembayaran supplier"},{accountId:receivable?allowedControlId:value.cashAccountId,debit:"0",credit:value.amount,description:"Mengurangi sisa tagihan"}];
      updateSource=async()=>{await tx.tradePayment.update({where:{id:payment.id,version:value.sourceVersion},data:{...data,version:{increment:1}}});await tx.tradeDocument.update({where:{id:document.id},data:{version:{increment:1}}});};
      checkBalance=()=>tradeBalance(tx,document.id);
    }
    const result=await updatePostedJournal(tx,actorId,entry,{journalNumber:value.journalNumber,date:value.date,description,lines,reason:value.reason},dependencies,allowedControlId,updateSource);
    const balance=await checkBalance();
    if(BigInt(balance.minimum)<0n || BigInt(balance.remaining)<0n)throw new JournalError("Perubahan membuat sisa historis negatif atau pembayaran melebihi nominal transaksi. Periksa nominal dan urutan tanggal.");
    await audit(tx,actorId,sourceId,"UPDATED",{journalId:entry.id,reason:value.reason,before,after},entity);
    await tx.journalRequest.create({data:{actorId,operation,requestKey:value.requestKey,payloadHash:fingerprint,result}});
    return result;
  },{timeout:30000,maxWait:10000}));
}
