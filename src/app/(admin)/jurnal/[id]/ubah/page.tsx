import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import Link from "@/components/year-link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { journalChoices } from "@/lib/journal/queries";
import { cashChoices,counterChoices } from "@/lib/trade/queries";
import { dateString,jakartaDate } from "@/lib/accounting/dates";
import { JournalForm } from "@/components/journal/journal-form";
import { SourceEditForm } from "@/components/journal/source-edit-form";
import type { SourceEditInput } from "@/lib/journal/source-validation";
import { openingChoices } from "@/lib/opening/queries";
export const metadata={title:"Ubah jurnal"};
export default async function EditJournalPage({params}:{params:Promise<{id:string}>}){
 await requireAdmin();const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const db=getPrisma(),entry=await db.journalEntry.findUnique({where:{id},include:{openingJournal:true,lines:{orderBy:{lineNo:"asc"},include:{account:true}},
  loan:true,loanPayment:{include:{loan:true}},tradeDocument:true,tradePayment:{include:{document:true}}}});
 if(!entry)notFound();
 if(entry.status==="REVERSED"||entry.sourceType==="REVERSAL")return <div className="space-y-4"><h1 className="text-2xl font-semibold">Riwayat jurnal</h1><p>Jurnal yang sudah dibatalkan pada versi sebelumnya tetap tersimpan dan tidak dapat diedit.</p><Link href={"/jurnal/"+id} className="text-primary underline">Kembali ke rincian</Link></div>;
 const header=<header className="space-y-2"><Link href={"/jurnal/"+id} className="text-sm text-primary underline">Kembali ke rincian jurnal</Link><h1 className="text-2xl font-semibold">Ubah jurnal</h1><p className="break-all font-mono text-sm">{entry.journalNumber}</p></header>;
 if(entry.sourceType==="MANUAL"){
  const choices:{id:string;code:string;name:string;normalBalance?:"DEBIT"|"CREDIT"}[]=entry.openingJournal?.perAccount
   ? await openingChoices(db)
   : await journalChoices(db);
  for(const line of entry.lines)if(!choices.some(account=>account.id===line.accountId))choices.push({id:line.account.id,code:line.account.code,name:line.account.name+" (pilih akun aktif untuk menyimpan)",normalBalance:line.account.normalBalance});
  return <div className="space-y-6">{header}{entry.status==="DRAFT"&&<p className="rounded-lg border p-4 text-sm">Catatan lama ini belum masuk pembukuan. Periksa dan simpan untuk langsung mempostingnya.</p>}<JournalForm accounts={choices} today={jakartaDate()} fixedDate={Boolean(entry.openingJournal)} perAccountOpening={entry.openingJournal?.perAccount} initial={{id,version:entry.version,journalNumber:entry.journalNumber,date:dateString(entry.date),description:entry.description,lines:entry.lines.map(line=>({accountId:line.accountId,debit:line.debit.toFixed(0),credit:line.credit.toFixed(0),description:line.description??""}))}}/></div>;
 }
 const common={id,version:entry.version,journalNumber:entry.journalNumber,reason:"",requestKey:randomUUID(),date:dateString(entry.date)};
 let initial:SourceEditInput,relatedLabel:string,relatedHref:string,choices:{id:string;code:string;name:string}[];
 if(entry.loan){const loan=entry.loan;initial={...common,sourceType:"LOAN",sourceVersion:loan.version,employeeName:loan.employeeName,amount:loan.amount.toFixed(0),cashAccountId:loan.cashAccountId,dueDate:loan.dueDate?dateString(loan.dueDate):"",notes:loan.notes??""};relatedLabel="Pinjaman "+loan.loanNumber+" · "+loan.employeeName;relatedHref="/pinjaman-karyawan/"+loan.id;choices=await cashChoices(db);}
 else if(entry.loanPayment){const payment=entry.loanPayment,loan=payment.loan;initial={...common,sourceType:"LOAN_PAYMENT",sourceVersion:payment.version,parentVersion:loan.version,amount:payment.amount.toFixed(0),cashAccountId:payment.cashAccountId,notes:payment.notes??""};relatedLabel="Cicilan "+payment.paymentNumber+" · "+loan.employeeName;relatedHref="/pinjaman-karyawan/"+loan.id;choices=await cashChoices(db);}
 else if(entry.tradeDocument){const document=entry.tradeDocument;initial={...common,sourceType:"TRADE_DOCUMENT",kind:document.kind,sourceVersion:document.version,partyName:document.partyName,amount:document.amount.toFixed(0),counterAccountId:document.counterAccountId,dueDate:document.dueDate?dateString(document.dueDate):"",externalReference:document.externalReference??"",notes:document.notes??""};relatedLabel="Tagihan "+document.documentNumber+" · "+document.partyName;relatedHref=(document.kind==="RECEIVABLE"?"/piutang-customer/":"/utang-supplier/")+document.id;choices=await counterChoices(db,document.kind);}
 else if(entry.tradePayment){const payment=entry.tradePayment,document=payment.document;initial={...common,sourceType:"TRADE_PAYMENT",kind:document.kind,sourceVersion:payment.version,parentVersion:document.version,amount:payment.amount.toFixed(0),cashAccountId:payment.cashAccountId,notes:payment.notes??""};relatedLabel="Pembayaran "+payment.paymentNumber+" · "+document.partyName;relatedHref=(document.kind==="RECEIVABLE"?"/piutang-customer/":"/utang-supplier/")+document.id;choices=await cashChoices(db);}
 else return <p>Transaksi asal jurnal belum tersedia. <Link href={"/jurnal/"+id}>Kembali ke rincian</Link></p>;
 const accountId="counterAccountId"in initial?initial.counterAccountId:initial.cashAccountId;
 if(!choices.some(account=>account.id===accountId)){const current=await db.account.findUnique({where:{id:accountId}});if(current)choices.push({id:current.id,code:current.code,name:current.name+" (pilih akun aktif untuk menyimpan)"});}
 return <div className="space-y-6">{header}<SourceEditForm initial={initial} accounts={choices} relatedLabel={relatedLabel} relatedHref={relatedHref}/></div>;
}
