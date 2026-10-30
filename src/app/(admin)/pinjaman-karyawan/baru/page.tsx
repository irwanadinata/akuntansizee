import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { cashChoices } from "@/lib/loans/queries";
import { jakartaDate } from "@/lib/accounting/dates";
import { withFiscalYear } from "@/lib/fiscal/context";
import { fiscalDate } from "@/lib/fiscal/selection";
import type { SearchParams } from "@/lib/reports/parameters";
import { LoanForm } from "@/components/loans/loan-form";
export const metadata={title:"Catat Pinjaman"};
export default async function NewLoanPage({searchParams}:{searchParams:Promise<SearchParams>}) { await requireAdmin();const scope=await withFiscalYear(await searchParams); return <div className="space-y-6"><header><h1 className="text-2xl font-semibold">Catat Pinjaman</h1><p className="mt-2 text-sm text-muted-foreground">Isi nama karyawan dan uang yang dikeluarkan. Jurnal dicatat otomatis.</p></header><LoanForm accounts={await cashChoices(getPrisma())} today={fiscalDate(scope.year,jakartaDate())}/></div>; }
