export const creationKinds = ["loan", "receivable", "payable", "account"] as const;
export type CreationKind = typeof creationKinds[number];

export const creationOptions = {
  account: { title: "Tambah akun", description: "Isi identitas dan klasifikasi akun. Tidak ada saldo awal yang dibuat.", href: "/coa/baru" },
  loan: { title: "Catat Pinjaman", description: "Isi nama karyawan, jumlah pinjaman, dan Kas/Bank sumber.", href: "/pinjaman-karyawan/baru" },
  receivable: { title: "Buat Tagihan Customer", description: "Isi nama customer, jumlah tagihan, dan sumber pendapatan.", href: "/piutang-customer/baru" },
  payable: { title: "Catat Tagihan Supplier", description: "Isi nama supplier, jumlah tagihan, dan kategori pengeluaran.", href: "/utang-supplier/baru" },
} satisfies Record<CreationKind, { title: string; description: string; href: string }>;

type AccountChoice = { id: string; name: string };
export type CreationData =
  | { kind: "account" }
  | { kind: "loan"; today: string; accounts: AccountChoice[] }
  | { kind: "receivable" | "payable"; today: string; accounts: (AccountChoice & { mainType: string; reportGroup: string })[] };
export type CreationDataResult = { ok: true; data: CreationData } | { ok: false; message: string };
