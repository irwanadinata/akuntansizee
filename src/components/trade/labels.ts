import type { TradeKind } from "@/lib/trade/validation";

export function tradeLabels(kind: TradeKind) {
  return kind === "RECEIVABLE"
    ? {
        path: "/piutang-customer",
        title: "Piutang Customer",
        party: "Customer",
        partyField: "Nama customer",
        create: "Buat Tagihan Customer",
        payment: "Catat Pembayaran",
        paymentTitle: "Terima Pembayaran Customer",
        received: "Sudah diterima",
        cashField: "Pembayaran diterima di",
        counterField: "Pendapatan dari",
        externalField: "Nomor Faktur Customer (opsional)",
        control: "Piutang Usaha",
      }
    : {
        path: "/utang-supplier",
        title: "Utang Supplier",
        party: "Supplier",
        partyField: "Nama supplier",
        create: "Catat Tagihan Supplier",
        payment: "Bayar Sekarang",
        paymentTitle: "Bayar Tagihan Supplier",
        received: "Sudah dibayar",
        cashField: "Uang dibayarkan dari",
        counterField: "Kategori pengeluaran",
        externalField: "Nomor Referensi Supplier (opsional)",
        control: "Utang Usaha",
      };
}

export function tradeStatus(reversalEntryId: string | null, remaining: string, paid: string) {
  if (reversalEntryId) return "Dibatalkan";
  if (remaining === "0") return "Lunas";
  if (BigInt(paid) > 0n) return "Sebagian";
  return "Belum Lunas";
}
