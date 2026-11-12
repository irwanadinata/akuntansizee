import Link from "@/components/year-link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getPrisma } from "@/lib/db";
import { displayDate, displayTime } from "@/lib/accounting/dates";
import { formatRupiah } from "@/lib/accounting/money";
import { JournalAuditDetails } from "@/components/journal/audit-details";
import { DeletedJournalDetails } from "@/components/journal/deleted-journal-details";
import { DeleteJournalButton } from "@/components/journal/delete-journal-button";
import { journalDeletionBlock } from "@/lib/journal/deletion";
import { Button } from "@/components/ui/button";
export const metadata = { title: "Rincian jurnal" };
export default async function JournalDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); const { id } = await params; if (!z.uuid().safeParse(id).success) notFound();
  const db = getPrisma(), entry = await db.journalEntry.findUnique({ where: { id }, include: { fiscalYear: { select: { status: true } }, openingJournal: true, lines: { orderBy: { lineNo: "asc" }, include: { account: true } }, reverseOf: true, reversal: true, tradeDocument: { select: { id: true, kind: true } }, reversedTradeDocument: { select: { id: true, kind: true } }, tradePayment: { select: { document: { select: { id: true, kind: true } } } }, reversedTradePayment: { select: { document: { select: { id: true, kind: true } } } }, loan: { select: { id: true } }, reversedLoan: { select: { id: true } }, loanPayment: { select: { loanId: true } }, reversedPayment: { select: { loanId: true } }, createdBy: { select: { email: true } } } });
  if (!entry) {
    const deleted = await db.auditEvent.findFirst({ where: { entity: "JOURNAL", entityId: id, action: "DELETED" }, include: { actor: { select: { email: true } } } });
    if (!deleted) notFound();
    const accounts = Object.fromEntries((await db.account.findMany({ select: { id: true, code: true, name: true } })).map(account => [account.id, account.code + " · " + account.name]));
    return <DeletedJournalDetails event={deleted} accounts={accounts} />;
  }
  const deletionBlock = journalDeletionBlock(entry);
  const tradeDocument = entry.tradeDocument ?? entry.reversedTradeDocument ?? entry.tradePayment?.document ?? entry.reversedTradePayment?.document;
  const tradePath = tradeDocument?.kind === "RECEIVABLE" ? "/piutang-customer/" : "/utang-supplier/";
  const loanId = entry.loan?.id ?? entry.reversedLoan?.id ?? entry.loanPayment?.loanId ?? entry.reversedPayment?.loanId;
  const audit = await db.auditEvent.findMany({ where: { entity: "JOURNAL", entityId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { actor: { select: { email: true } } } });
  const historyAccounts = audit.some(item=>item.action==="EDITED") ? Object.fromEntries((await db.account.findMany({select:{id:true,code:true,name:true}})).map(account=>[account.id,account.code+" · "+account.name])) : {};
  const actions: Record<string, string> = { CREATED: "Catatan dibuat", UPDATED: "Catatan diubah", POSTED: "Jurnal diposting", EDITED: "Jurnal diperbarui", REVERSED: "Jurnal dibatalkan", POSTED_REVERSAL: "Pembalik diposting" };
  return <div className="space-y-6"><header className="space-y-2"><Link href="/jurnal" className="text-sm text-primary underline">Kembali ke Jurnal</Link><h1 className="break-all text-xl font-semibold sm:text-2xl">{entry.journalNumber}</h1><p>{displayDate(entry.date)} · {entry.status === "DRAFT" ? "Belum dicatat - lengkapi dan simpan" : entry.status === "POSTED" ? "Terposting" : "Dibatalkan dengan pembalik"}</p><p className="text-sm text-muted-foreground">{entry.description}</p>{entry.postedAt && <p className="text-sm">Diposting {displayTime(entry.postedAt)}</p>}{entry.reverseOf && <p className="text-sm">Pembalik dari <Link href={"/jurnal/" + entry.reverseOf.id} className="text-primary underline">{entry.reverseOf.journalNumber}</Link></p>}{entry.reversal && <p className="text-sm">Dibatalkan oleh <Link href={"/jurnal/" + entry.reversal.id} className="text-primary underline">{entry.reversal.journalNumber}</Link> pada {displayDate(entry.reversal.date)}. Alasan: {entry.reversalReason}</p>}</header>
    {entry.openingJournal && <section className="space-y-2 rounded-lg border p-4 text-sm"><h2 className="font-semibold">Jurnal Saldo Pembukaan</h2><p>Cutover {displayDate(entry.openingJournal.cutoverDate)} · Disetujui {displayTime(entry.openingJournal.confirmedAt)}</p><p>Rujukan verifikasi: {entry.openingJournal.verificationNote}</p><p>Penanda pembukaan mencegah impor ulang saldo pembukaan.</p><Link className="text-primary underline" href="/saldo-pembukaan">Lihat proses saldo pembukaan</Link></section>}
    {loanId && <p className="rounded-lg border p-4 text-sm">Jurnal otomatis pinjaman/cicilan. Lihat <Link className="text-primary underline" href={"/pinjaman-karyawan/" + loanId}>rincian pinjaman terkait</Link>.</p>}
    {tradeDocument && <p className="rounded-lg border p-4 text-sm">Jurnal otomatis piutang/utang. Lihat <Link className="text-primary underline" href={tradePath + tradeDocument.id}>rincian tagihan terkait</Link>.</p>}
    <div className="overflow-x-auto rounded-xl border bg-card"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-muted"><tr>{["Akun", "Keterangan", "Debit", "Kredit"].map(label => <th className="p-4" key={label}>{label}</th>)}</tr></thead><tbody>{entry.lines.map(line => <tr key={line.id} className="border-t"><td className="p-4">{line.account.code} · {line.account.name}</td><td className="p-4">{line.description ?? "—"}</td><td className="p-4 tabular-nums">{formatRupiah(line.debit.toFixed(0))}</td><td className="p-4 tabular-nums">{formatRupiah(line.credit.toFixed(0))}</td></tr>)}</tbody><tfoot className="border-t font-semibold"><tr><td className="p-4" colSpan={2}>Total</td>{(["debit", "credit"] as const).map(side => <td key={side} className="p-4">{formatRupiah(entry.lines.reduce((sum, line) => sum + BigInt(line[side].toFixed(0)), 0n))}</td>)}</tr></tfoot></table></div>
    {entry.status !== "REVERSED" && entry.sourceType !== "REVERSAL" && <Button asChild><Link href={"/jurnal/" + id + "/ubah"}>Ubah jurnal</Link></Button>}
    {deletionBlock ? <p className="text-sm text-muted-foreground">{deletionBlock}</p> : <DeleteJournalButton id={id} version={entry.version} journalNumber={entry.journalNumber} />}
    <section className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Riwayat tindakan</h2><ul className="mt-4 space-y-3 text-sm">{audit.map(item => <li key={item.id}>{displayTime(item.createdAt)} · {actions[item.action] ?? item.action} · {item.actor.email}{item.action==="EDITED"&&<JournalAuditDetails details={item.details} accounts={historyAccounts}/>}</li>)}</ul></section>
  </div>;
}
