import Link from "@/components/year-link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { cashChoices,loanDetail } from "@/lib/loans/queries";
import { dateString,jakartaDate } from "@/lib/accounting/dates";
import { withFiscalYear } from "@/lib/fiscal/context";
import { fiscalDate } from "@/lib/fiscal/selection";
import type { SearchParams } from "@/lib/reports/parameters";
import { LoanForm } from "@/components/loans/loan-form";
export const metadata={title:"Catat Cicilan"};
export default async function PaymentPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<SearchParams>}) {
  await requireAdmin();const scope=await withFiscalYear(await searchParams),date=fiscalDate(scope.year,jakartaDate()); const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();const db=getPrisma(),result=await loanDetail(db,id);if(!result)notFound();
  if(result.loan.reversalEntryId||result.balance.remaining==="0")return <div className="space-y-4"><h1 className="text-2xl font-semibold">Pinjaman sudah {result.loan.reversalEntryId?"dibatalkan":"lunas"}</h1><Link className="text-primary underline" href={"/pinjaman-karyawan/"+id}>Kembali ke rincian pinjaman</Link></div>;
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Catat Cicilan</h1><LoanForm accounts={await cashChoices(db)} today={date<dateString(result.loan.date)?dateString(result.loan.date):date} loan={{id,employeeName:result.loan.employeeName,remaining:result.balance.remaining}}/></div>;
}
