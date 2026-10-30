import { requireAdmin } from "@/lib/auth/session";
import { FinancialView } from "@/components/reports/financial-view";
import type { SearchParams } from "@/lib/reports/parameters";
export const metadata={title:"Laporan Keuangan"};
export default async function ReportPage({searchParams}:{searchParams:Promise<SearchParams>}){await requireAdmin();return <FinancialView type="combined" params={await searchParams}/>;}
