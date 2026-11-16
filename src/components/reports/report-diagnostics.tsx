import Link from "@/components/year-link";
import { formatRupiah } from "@/lib/accounting/money";
import { reportNotices } from "@/lib/reports/diagnostics";
import type { FinancialReport } from "@/lib/reports/engine";

export function ReportDiagnostics({ report }: { report: FinancialReport }) {
  const data = report.diagnostics, notices = reportNotices(report);
  return <section className="report-diagnostics space-y-3 rounded-xl border bg-card p-5">
    <h2 className="font-semibold">Pemeriksaan laporan</h2>
    {notices.map(notice => <div key={notice.kind} role="alert" className={notice.kind === "opening"
      ? "space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
      : "space-y-3 rounded-lg border border-destructive p-4 text-sm text-destructive"}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{notice.title}</h3>
        <span className="rounded-full border border-current px-2 py-0.5 text-xs font-medium">{notice.status}</span>
      </div>
      {notice.paragraphs.map((paragraph, index) => <p key={index} className="break-words">{paragraph}</p>)}
    </div>)}
    {!notices.length && <p className="text-sm text-primary">Neraca seimbang, debit/kredit cocok dan rincian akun kontrol sesuai pada snapshot ini.</p>}
    <p className="text-sm">Debit kumulatif {formatRupiah(data.trialDebit)} · Kredit {formatRupiah(data.trialCredit)} · Selisih {formatRupiah(data.trialDifference)}</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm">
      <caption className="sr-only">Rekonsiliasi akun kontrol sampai tanggal laporan</caption>
      <thead><tr>{["Akun kontrol", "Buku Besar", "Rincian", "Selisih"].map(label => <th key={label} className="p-2 text-left last:text-right">{label}</th>)}</tr></thead>
      <tbody>{data.reconciliations.map(row => <tr key={row.code} className="border-t"><td className="p-2">{row.name}</td>{[row.control, row.detail, row.difference].map((amount, i) => <td key={i} className="p-2 text-right tabular-nums">{formatRupiah(amount)}</td>)}</tr>)}</tbody>
    </table></div>
    {data.invalidJournals.map(row => <p key={row.id} className="text-sm"><Link href={"/jurnal/" + row.id} className="text-destructive underline">Periksa {row.journalNumber}</Link></p>)}
  </section>;
}
