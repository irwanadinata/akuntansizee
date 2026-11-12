export function journalDeletionBlock(entry: {
  sourceType: string;
  status: string;
  openingJournal?: unknown;
  fiscalYear?: { status: string };
}): string | null {
  if (entry.status === "REVERSED" || entry.sourceType === "REVERSAL") return "Jurnal yang memiliki riwayat pembalik tidak dapat dihapus.";
  if (entry.sourceType !== "MANUAL") return "Jurnal otomatis terhubung dengan transaksi asal dan tidak dapat dihapus melalui menu Jurnal.";
  if (entry.openingJournal) return "Jurnal saldo pembukaan tidak dapat dihapus karena menjadi dasar saldo awal perusahaan.";
  if (entry.fiscalYear?.status !== undefined && entry.fiscalYear.status !== "OPEN") return "Tahun buku terkunci. Buka periode sebelum menghapus jurnal.";
  return null;
}
