import { notFound } from "next/navigation";
import Link from "@/components/year-link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { journalChoices } from "@/lib/journal/queries";
import { dateString, jakartaDate } from "@/lib/accounting/dates";
import { JournalForm } from "@/components/journal/journal-form";
export const metadata = { title: "Ubah draf jurnal" };
export default async function EditJournalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const db = getPrisma(), entry = await db.journalEntry.findUnique({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" }, include: { account: true } } } });
  if (!entry) notFound();
  if (entry.status !== "DRAFT") return <p>Jurnal terposting tidak dapat diubah. <Link href={"/jurnal/" + id} className="text-primary underline">Kembali ke rincian</Link></p>;
  const choices = await journalChoices(db);
  for (const line of entry.lines) if (!choices.some(account => account.id === line.accountId)) choices.push({ id: line.account.id, code: line.account.code, name: line.account.name + " (tidak tersedia untuk posting)" });
  return <div className="space-y-6"><h1 className="text-2xl font-semibold">Ubah draf jurnal</h1><JournalForm accounts={choices} today={jakartaDate()} initial={{ id, version: entry.version, journalNumber: entry.journalNumber, date: dateString(entry.date), description: entry.description, lines: entry.lines.map(line => ({ accountId: line.accountId, debit: line.debit.toFixed(0), credit: line.credit.toFixed(0), description: line.description ?? "" })) }} /></div>;
}
