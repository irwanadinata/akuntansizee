import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { journalChoices } from "@/lib/journal/queries";
import { jakartaDate } from "@/lib/accounting/dates";
import { withFiscalYear } from "@/lib/fiscal/context";
import { fiscalDate } from "@/lib/fiscal/selection";
import type { SearchParams } from "@/lib/reports/parameters";
import { JournalForm } from "@/components/journal/journal-form";
export const metadata = { title: "Jurnal manual baru" };
export default async function NewJournalPage({searchParams}:{searchParams:Promise<SearchParams>}) {
  await requireAdmin();const scope=await withFiscalYear(await searchParams);
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Jurnal manual baru · Lanjutan</h1><JournalForm accounts={await journalChoices(getPrisma())} today={fiscalDate(scope.year,jakartaDate())} /></div>;
}
