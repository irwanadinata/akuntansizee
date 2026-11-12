import { z } from "zod";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import Link from "@/components/year-link";
import { displayDate, displayTime } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";

const deletion = z.object({ reason: z.string(), before: z.object({
  journalNumber: z.string(), date: z.string(), description: z.string(),
  lines: z.array(z.object({ accountId: z.string(), debit: z.string().regex(/^\d+$/), credit: z.string().regex(/^\d+$/), description: z.string() })),
}) });

export function DeletedJournalDetails({ event, accounts }: {
  event: { details: Prisma.JsonValue; createdAt: Date; actor: { email: string } }; accounts: Record<string, string>;
}) {
  const parsed = deletion.safeParse(event.details);
  if (!parsed.success) notFound();
  const { before, reason } = parsed.data;
  return <div className="space-y-6">
    <Link href="/jurnal" className="text-sm text-primary underline">Kembali ke Jurnal</Link>
    <header className="space-y-2"><h1 className="break-all text-2xl font-semibold">{before.journalNumber}</h1><p className="font-semibold text-destructive">Jurnal sudah dihapus</p><p>{displayDate(before.date)} · {before.description}</p></header>
    <section className="space-y-2 rounded-xl border bg-card p-5 text-sm"><h2 className="font-semibold">Riwayat penghapusan</h2><p>{displayTime(event.createdAt)} · {event.actor.email}</p><p>Alasan: {reason}</p><p>Salinan di bawah adalah riwayat audit dan tidak memengaruhi saldo atau laporan. Nomor jurnal tetap tersimpan dan tidak dapat digunakan ulang.</p></section>
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[650px] text-left text-sm"><caption className="p-4 text-left font-semibold">Rincian sebelum dihapus</caption><thead className="bg-muted"><tr>{["Akun", "Keterangan", "Debit", "Kredit"].map(label => <th key={label} className="p-4">{label}</th>)}</tr></thead><tbody>{before.lines.map((line, index) => <tr key={index} className="border-t"><td className="p-4">{accounts[line.accountId] ?? line.accountId}</td><td className="p-4">{line.description || "—"}</td><td className="p-4 tabular-nums">{formatRupiah(line.debit)}</td><td className="p-4 tabular-nums">{formatRupiah(line.credit)}</td></tr>)}</tbody></table></div>
  </div>;
}
