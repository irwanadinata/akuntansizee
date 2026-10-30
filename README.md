# Akuntansi PT Zee Komunikasi Indonesia

Aplikasi pembukuan internal PT Zee Komunikasi Indonesia untuk **satu perusahaan dan satu admin**. Pencatatan tagihan, pembayaran, pinjaman dan cicilan terhubung dengan jurnal double-entry, Buku Besar dan laporan keuangan.

Pembukuan baru dimulai dengan **saldo Rp0 tanpa jurnal**. Seed hanya menyiapkan daftar akun. Saldo Pembukaan tersedia sebagai proses opsional untuk saldo historis yang sudah diverifikasi terpisah.

## Fitur

| Menu | Fungsi |
| --- | --- |
| Beranda | Akses cepat ke transaksi dan laporan. |
| Piutang Customer | Tagihan, pembayaran sebagian/penuh, sisa tagihan dan riwayat pembayaran. |
| Utang Supplier | Tagihan dengan kategori Beban/HPP/Aset, pembayaran dan sisa utang. |
| Pinjaman Karyawan | Pinjaman, cicilan, sisa otomatis dan status pelunasan. |
| Jurnal | Draf, posting, jurnal otomatis dan koreksi melalui jurnal pembalik. |
| Buku Besar | Filter akun/tahun/tanggal, saldo sebelum periode dan saldo berjalan. |
| Neraca | Posisi keuangan per tanggal, saldo lintas tahun dan laba berjalan. |
| Laba Rugi | Pendapatan, HPP, laba kotor, beban, hasil lainnya dan laba bersih. |
| Laporan Keuangan | Neraca dan Laba Rugi gabungan, pemeriksaan saldo kontrol, cetak dan PDF. |
| Daftar Akun (COA) | Cari/filter, tambah, edit, nonaktifkan dan hapus akun yang belum pernah dipakai. |
| Tahun Buku | Tambah tahun, pilih tahun aktif dan kunci/buka periode dengan alasan. |
| Saldo Pembukaan | Preview dan posting pembukaan seimbang, sekali per perusahaan. |

Nama karyawan, customer dan supplier disimpan langsung pada transaksi. Tidak diperlukan master pihak atau akun COA per orang. Nomor faktur customer/referensi supplier eksternal bersifat opsional dan terpisah dari nomor internal.

UI berbahasa Indonesia menggunakan format Rupiah bulat, tanggal bisnis **Asia/Jakarta**, sidebar responsif dan filter tahun yang dipertahankan antar-menu. Tambah tagihan, pinjaman dan akun COA dari daftar membuka **panel dari kanan**, dengan halaman daftar tetap terlihat. Filter, navigasi, penyimpanan, login/logout, pergantian tahun dan PDF memiliki indikator loading. Form transaksi harian memakai langkah isi → periksa → simpan; debit/kredit manual tersedia pada menu Jurnal lanjutan.

Panduan penggunaan: [Panduan Admin](docs/09-panduan-admin.md). Buku panduan PDF 44 halaman dapat diunduh setelah login melalui tombol **Download Panduan** pada navbar. File yang disertakan dalam deployment berada di `assets/guides/buku-panduan.pdf` dan dilayani melalui `/panduan`.

## Stack dan kebutuhan

- Node.js **22.12 atau lebih baru**, npm dan `package-lock.json`.
- Next.js **16** App Router, React **19** dan TypeScript.
- Tailwind CSS **4**, komponen shadcn/ui dan Lucide.
- React Hook Form dan Zod.
- Prisma ORM **7**, adapter `@prisma/adapter-neon` dan **Neon PostgreSQL**.
- PDFKit dengan font lokal di `assets/fonts/`.

Aplikasi menggunakan Neon; tidak menyediakan fallback PostgreSQL lokal atau SQLite. Source, typecheck, unit test dan build dapat disiapkan tanpa kredensial asli. Login dan transaksi memerlukan database yang sudah dimigrasi serta admin yang sudah dibuat.

## Setup development

### 1. Instal dependensi dan siapkan env

Jalankan dari root proyek. Jika `.env.local` sudah ada, pertahankan isinya dan periksa konfigurasi yang diperlukan.

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env.local)) {
    Copy-Item -LiteralPath .env.example -Destination .env.local
}
```

Buat project/branch **Neon development** terpisah dari production. Untuk pembukuan baru gunakan database development kosong. Ambil dua URL dari **database dan branch yang sama**, lalu isi enam variabel berikut pada `.env.local`:

| Variabel | Kegunaan |
| --- | --- |
| `DATABASE_URL` | URL Neon **pooled**, hostname `-pooler`, untuk runtime server. |
| `DIRECT_URL` | URL Neon **direct/non-pooled** untuk Prisma CLI, bootstrap admin dan seed administratif. |
| `APP_ORIGIN` | Origin aplikasi, misalnya `http://localhost:3000` saat development. Production wajib HTTPS sesuai deployment. |
| `AUTH_SECRET` | Secret acak kuat, minimal 32 karakter. |
| `SEED_ADMIN_EMAIL` | Email admin awal untuk bootstrap. |
| `SEED_ADMIN_PASSWORD` | Password admin awal: minimal 12 karakter, maksimal 72 byte, huruf besar/kecil, angka dan simbol. |

Kedua URL wajib memakai TLS, misalnya `sslmode=require`. Placeholder pada template harus diganti; URL tertukar, database lokal dan TLS tidak aman ditolak. Buat secret sendiri dengan:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Simpan kredensial hanya di env server. File `.env` dan `.env.local` diabaikan Git. Script CLI memuat env dengan prioritas **process → .env.local → .env**, tanpa menimpa env proses. Tidak ada variabel kredensial `NEXT_PUBLIC_*`.

### 2. Migrasi development dan buat admin

Pastikan env menunjuk **Neon development yang benar** sebelum menjalankan:

```powershell
npm run db:migrate:dev
npm run admin:create
```

Prisma CLI membaca `DIRECT_URL` melalui `prisma.config.ts`; Prisma Client memakai adapter Neon server-side dengan `DATABASE_URL`. `migrate dev` memerlukan shadow database; jika izin lingkungan tidak mencukupi, siapkan shadow database Neon development sesuai konfigurasi Prisma. Production tidak boleh menjadi shadow database.

Migrasi menyiapkan tabel dan constraint tanpa transaksi/saldo contoh. `admin:create` membuat admin pertama; admin yang sudah ada dilewati tanpa mengganti email atau password. Script ini bukan reset password. Setelah bootstrap, keluarkan `SEED_ADMIN_PASSWORD` dari env runtime/deployment; isi kembali hanya bila diperlukan untuk prosedur administratif yang sah.

### 3. Siapkan COA awal

Untuk instalasi baru, periksa mapping yang disahkan lalu jalankan seed secara eksplisit:

```powershell
npm run coa:check
npm run coa:audit
npm run db:seed
```

Seed bersifat idempotent, tidak membuat saldo/jurnal dan tidak menimpa akun yang dibuat atau diedit admin. Jangan menjalankan seed otomatis pada deployment production. Rincian persetujuan dan perilaku re-seed ada pada bagian COA di bawah.

### 4. Jalankan aplikasi

```powershell
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000), masuk menggunakan admin yang telah dibuat, lalu tambahkan/pilih **Tahun Buku** sebelum mencatat transaksi. Tidak ada akun demo, signup atau login bypass.

## Aturan pembukuan

- Saldo dan laporan bersumber dari jurnal dengan `postingStatus = POSTED`; draf tidak memengaruhi saldo. Jurnal asal yang dibalik tetap dihitung pada tanggal asal dan jurnal pembalik pada tanggal efektifnya.
- Posting harus memenuhi total debit = total kredit dan total positif. Nominal memakai Rupiah bulat, bukan perhitungan floating point.
- Jurnal terposting tidak dapat diedit/dihapus. Koreksi dilakukan melalui pembalik yang menautkan jurnal asal. Jurnal otomatis dikoreksi melalui modul transaksi pemiliknya.
- Mutasi subledger, jurnal, audit dan hasil idempotency berada dalam transaksi database atomik. Penguncian dan validasi sisa melindungi pembayaran/cicilan dari overpayment simultan.
- Akun kontrol Piutang Usaha, Utang Usaha dan Piutang Karyawan diblokir pada jurnal manual dan pembukaan agregat tanpa rincian subledger.
- Tahun terkunci menolak posting/backdate. Mengunci tahun **tidak membuat jurnal penutup otomatis**.
- Tidak ada saldo akun yang dapat diedit, akun penyeimbang otomatis atau impor angka dari laporan contoh 2025. Jika laporan/kontrol berselisih, tampilkan dan telusuri selisihnya.

**Saldo Pembukaan opsional:** admin memasukkan angka historis terverifikasi, tanggal cutover dan rujukan verifikasi, memeriksa preview, lalu mengonfirmasi posting. Total harus seimbang dan positif, tahun terbuka, akun aktif serta klasifikasi sudah disahkan. Marker perusahaan dan idempotency mencegah posting kedua, termasuk setelah jurnal pembukaan dibalik. Buku baru dapat langsung bertransaksi tanpa proses ini.

### Nomor transaksi

Nomor dibuat server-side menggunakan `node:crypto` dengan format **`PREFIX-YYYYMMDD-RANDOM`**, tanggal pembuatan WIB dan bagian acak 12 karakter. ID relasi internal tetap UUID.

| Prefix | Transaksi |
| --- | --- |
| `JRN` | Jurnal, termasuk setiap jurnal otomatis dan jurnal pembalik. |
| `PJM` / `CIC` | Pinjaman karyawan / cicilan. |
| `PIU` / `BYC` | Tagihan customer / pembayaran customer. |
| `UTG` / `BYS` | Tagihan supplier / pembayaran supplier. |

Nomor memiliki unique constraint DB dan retry collision maksimal lima percobaan. Idempotency key yang sama dengan isi sama mengembalikan hasil yang sama; isi berbeda ditolak. Nomor tetap saat edit draf, posting, refresh dan ekspor. Buku Besar diurutkan dengan tanggal/timestamp/id, bukan nomor acak.

### COA yang disahkan

Sumber `prisma/coa-source.json` dan `referensi/COA.xlsx` memuat 91 akun dengan duplikasi kode sumber `1122.1` dan `1130.1`. Aplikasi menggunakan keputusan **APPROVED: 91 akun dengan 91 kode STRING unik** pada `prisma/coa-code-decisions.json` dan snapshot `prisma/coa-approved.json`.

| Akun | Kode final |
| --- | --- |
| Piutang Karyawan | `1122.1` |
| Cadangan Kerugian Piutang | `1122.2` |
| Perlengkapan Kantor | `1130.1` |
| Pajak Dibayar di Muka PPh 23 | `1130.3` |

Kontra akun memakai saldo normal dan kelompok yang disahkan. Selisih kurs/pelepasan aset memakai hasil neto `OTHER_RESULT`; pajak penghasilan memiliki kelompok tersendiri. Seed menolak keputusan yang belum disetujui/tidak lengkap atau konflik identitas akun. Akun yang pernah dipakai tetap terlindungi meskipun draf asal dihapus; gunakan nonaktifkan untuk menghentikan pemakaian baru.

Rincian: [Keputusan Data](docs/06-keputusan-data.md) dan [Penyelesaian Konflik COA](docs/11-penyelesaian-konflik-coa.md). Jangan mengubah sumber Excel/JSON atau mengesahkan ulang mapping secara otomatis.

## Laporan dan ekspor

Neraca menghitung saldo kumulatif sampai tanggal akhir, termasuk lintas tahun dan hasil usaha yang relevan. Laba Rugi mengikuti rentang tanggal terpilih. Akun pada laporan dapat ditelusuri ke Buku Besar dan jurnal tersimpan.

Pemeriksaan laporan membandingkan keseimbangan Neraca, debit/kredit dan tiga kontrol subledger. Kondisi yang belum cocok menampilkan peringatan **BUKAN LAPORAN FINAL**; tidak dipaksa seimbang.

Cetak menggunakan dialog browser dan mencetak konten halaman saat ini. PDF server tersedia untuk Neraca, Laba Rugi, gabungan dan Buku Besar, dengan perusahaan/periode yang jelas. Ekspor lengkap dibatasi 5.000 jurnal sumber/baris Buku Besar; permintaan lebih besar ditolak tanpa memotong data diam-diam. Unduh PDF memiliki loading, pembatalan dan pesan kegagalan agar dapat dicoba lagi.

## Pemeriksaan dan pengujian

Pemeriksaan source tanpa akses database:

```powershell
npm run lint
npm run typecheck
npm test
npm run db:validate
npm run coa:check
npm run coa:audit
npm run build
```

`npm run typecheck` menjalankan generate Prisma Client dan `tsc --noEmit`; `npm test` menjalankan unit test. Generate/validate tidak membuka koneksi Neon. Jika env lokal sudah diisi, nilai URL tetap harus lolos validasi konfigurasi.

### Integration test Neon

Jalankan hanya pada **Neon development/test yang berizin**, dengan izin membuat/menghapus schema sementara. Variabel tes tidak perlu disimpan dalam `.env.example`; set pada proses saat menjalankan tes.

| Command | Konfirmasi wajib | URL direct opsional |
| --- | --- | --- |
| `npm run test:coa:neon` | `COA_TEST_CONFIRM` | `COA_TEST_DIRECT_URL` |
| `npm run test:journal:neon` | `JOURNAL_TEST_CONFIRM` | `JOURNAL_TEST_DIRECT_URL` |
| `npm run test:loans:neon` | `LOAN_TEST_CONFIRM` | `LOAN_TEST_DIRECT_URL` |
| `npm run test:trade:neon` | `TRADE_TEST_CONFIRM` | `TRADE_TEST_DIRECT_URL` |
| `npm run test:reports:neon` | `REPORT_TEST_CONFIRM` | `REPORT_TEST_DIRECT_URL` |
| `npm run test:opening:neon` | `OPENING_TEST_CONFIRM` | `OPENING_TEST_DIRECT_URL` |

Contoh suite jurnal:

```powershell
$env:JOURNAL_TEST_CONFIRM = "CREATE_TEMP_SCHEMA"
try {
    npm run test:journal:neon
} finally {
    Remove-Item Env:JOURNAL_TEST_CONFIRM -ErrorAction SilentlyContinue
}
```

Jika URL opsional tidak diisi, suite memakai `DIRECT_URL` hanya ketika konfirmasi tepat tersedia. Tanpa prasyarat, hasil **SKIP**, bukan lulus. Suite memakai schema `zee_journal_test_<UUID>`, migrasi dan data sintetis, lalu membersihkan schema miliknya; bukan migrasi/seed schema aplikasi. Setelah proses yang dihentikan paksa, periksa schema milik run tersebut.

QA browser mencakup sesi, formulir, panel, filter responsif dan loading. Reproduksi dan bukti per tahap tersedia pada [QA dan Serah Terima](docs/17-qa-dan-serah-terima.md), [UI Filter/Navigasi](docs/18-perapihan-filter-dan-navigasi.md), [Panel Pencatatan](docs/19-panel-pencatatan.md) dan [Loading](docs/20-loading-dan-status-proses.md). Laporan tahap mencatat kondisi saat pemeriksaan, bukan status live seluruh environment.

## Production, backup dan restore

Gunakan **Neon production terpisah dari development/test**, pasangan URL pooled/direct yang sesuai, `AUTH_SECRET` berbeda dan `APP_ORIGIN` HTTPS deployment. Simpan secret pada environment server penyedia hosting.

Sebelum menerapkan migrasi, review SQL dan siapkan backup/titik pemulihan. Setelah itu, jalankan proses deployment dari release yang sudah diperiksa:

```powershell
npm ci
npm run build
npm run db:migrate:deploy
npm start
```

**Production hanya memakai `migrate deploy`. Jangan memakai `migrate dev`, `migrate reset`, `db push`, seed reset atau seed otomatis saat deploy.** Bootstrap admin/COA instalasi production baru merupakan langkah administratif terpisah setelah tujuan database diverifikasi, bukan bagian startup aplikasi.

Atur backup dan retensi pemulihan Neon sesuai environment/paket yang digunakan. Untuk backup logis, gunakan `pg_dump` format custom melalui koneksi **direct** dengan kredensial yang dilindungi; simpan backup terenkripsi dan uji `pg_restore` ke Neon test terpisah. Verifikasi migrasi, COA, jurnal seimbang, saldo kontrol dan akses admin sebelum mengandalkan prosedur restore. Jangan menaruh URL/password dalam command yang disimpan ke repo atau log.

Keberhasilan tes pada schema sementara bukan bukti deployment HTTPS, pemisahan branch production atau latihan restore sudah selesai. Verifikasi ketiganya pada environment tujuan sebelum serah terima operasional.

## Keamanan dan batas fitur

Sesi admin menggunakan cookie HttpOnly/SameSite, Secure pada production, token yang di-hash dan pencabutan sesi saat logout. Halaman/server action memeriksa admin di server; aksi memakai validasi input dan pemeriksaan Origin sesuai mekanisme auth. Login memiliki throttle database. Tidak ada signup, role tambahan, multi-company, multi-tenant, API publik atau perhitungan pajak otomatis.

Batas yang masih ada:

- Beranda menyediakan akses cepat, belum angka KPI keuangan.
- Saldo akun dibaca lewat Buku Besar/laporan; daftar COA belum memiliki kolom saldo.
- Ganti/pulihkan password admin dan pengaturan identitas perusahaan belum tersedia melalui UI.
- Kunci tahun mengunci periode; jurnal penutup tidak dibuat otomatis.
- Saldo Pembukaan tidak mengimpor rincian historis subledger akun kontrol.

## Struktur proyek

```text
src/app/                 App Router, login, halaman admin, server actions dan ekspor PDF
src/components/          UI, filter, panel kanan, loading, form transaksi dan laporan
src/lib/auth/            Sesi, password, Origin, throttle dan bootstrap admin
src/lib/env/             Validasi konfigurasi server
src/lib/db*.ts           Prisma Client dan adapter Neon pooled/direct
src/lib/accounting/      Rupiah bulat dan tanggal bisnis WIB
src/lib/coa/              Klasifikasi, kebijakan akun dan seed idempotent
src/lib/journal/          Mesin jurnal, penomoran dan idempotency
src/lib/ledger/           Saldo sebelum periode dan saldo berjalan
src/lib/loans/            Pinjaman, cicilan dan rekonsiliasi
src/lib/trade/            Piutang, utang, pembayaran dan rekonsiliasi
src/lib/reports/          Agregasi laporan, diagnosis dan PDF
src/lib/fiscal/           Konteks pemilihan Tahun Buku
src/lib/opening/          Validasi dan posting pembukaan opsional
prisma/                  Schema, migrasi, sumber/keputusan COA dan seed
scripts/                 Bootstrap, audit COA, pemeriksaan route/secret dan QA browser
assets/fonts/            Font PDF dan lisensinya
tests/                   Unit test dan integration test Neon opt-in
docs/                    PRD, aturan akuntansi, panduan dan laporan implementasi
```

Dokumen acuan: [PRD](docs/01-prd.md), [Aturan Akuntansi](docs/02-aturan-akuntansi.md), [Database dan Seed](docs/03-database-dan-seed.md), [UI/UX](docs/04-ui-ux.md), [Acceptance Test](docs/05-acceptance-test.md), [Keputusan Data](docs/06-keputusan-data.md) serta [Neon dan Nomor Otomatis](docs/07-neon-dan-nomor-otomatis.md).
