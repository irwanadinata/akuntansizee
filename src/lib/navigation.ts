export type NavigationItem = {
  title: string;
  href: string;
  icon: "home" | "receivable" | "payable" | "loan" | "journal" | "ledger" | "balance" | "profit" | "reports" | "accounts" | "year" | "opening";
  description: string;
};

export const navigationGroups: { title: string; items: NavigationItem[] }[] = [
  {
    title: "Ruang kerja",
    items: [
      { title: "Beranda", href: "/", icon: "home", description: "Ringkasan pembukuan perusahaan." },
    ],
  },
  {
    title: "Catat transaksi",
    items: [
      { title: "Piutang Customer", href: "/piutang-customer", icon: "receivable", description: "Tagihan customer, pembayaran yang diterima, dan sisa tagihan." },
      { title: "Utang Supplier", href: "/utang-supplier", icon: "payable", description: "Tagihan supplier, pembayaran, dan sisa yang perlu dibayar." },
      { title: "Pinjaman Karyawan", href: "/pinjaman-karyawan", icon: "loan", description: "Pinjaman karyawan dan riwayat cicilannya." },
      { title: "Jurnal", href: "/jurnal", icon: "journal", description: "Pencatatan jurnal untuk kebutuhan akuntansi lanjutan." },
    ],
  },
  {
    title: "Laporan",
    items: [
      { title: "Buku Besar", href: "/buku-besar", icon: "ledger", description: "Riwayat transaksi dan saldo berjalan setiap akun." },
      { title: "Neraca", href: "/neraca", icon: "balance", description: "Posisi aset, kewajiban, dan ekuitas perusahaan." },
      { title: "Laba Rugi", href: "/laba-rugi", icon: "profit", description: "Pendapatan dan beban dalam periode yang dipilih." },
      { title: "Laporan Keuangan", href: "/laporan-keuangan", icon: "reports", description: "Neraca dan laba rugi dalam satu tampilan." },
    ],
  },
  {
    title: "Pengaturan",
    items: [
      { title: "Daftar Akun (COA)", href: "/coa", icon: "accounts", description: "Daftar akun dan pengelompokan pembukuan perusahaan." },
      { title: "Tahun Buku", href: "/tahun-buku", icon: "year", description: "Periode pencatatan dan status penguncian tahun buku." },
      { title: "Saldo Pembukaan", href: "/saldo-pembukaan", icon: "opening", description: "Opsional, hanya untuk saldo historis yang telah diverifikasi terpisah." },
    ],
  },
];

export const navigationItems = navigationGroups.flatMap((group) => group.items);

export function getModuleNavigation(slug: string) {
  return navigationItems.find((item) => item.href !== "/" && item.href === `/${slug}`);
}
