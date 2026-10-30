import assert from "node:assert/strict";

// Run against an already started LOCAL app, never a user's live database.
const base = new URL(process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Pemeriksaan hanya untuk server lokal.");

const protectedRoutes = [
  "/", "/piutang-customer", "/utang-supplier", "/pinjaman-karyawan", "/jurnal",
  "/buku-besar", "/neraca", "/laba-rugi", "/laporan-keuangan", "/coa", "/tahun-buku",
  "/coa/baru", "/coa/00000000-0000-4000-8000-000000000001",
  "/jurnal/baru", "/jurnal/00000000-0000-4000-8000-000000000001", "/jurnal/00000000-0000-4000-8000-000000000001/ubah",
  "/pinjaman-karyawan/baru", "/pinjaman-karyawan/00000000-0000-4000-8000-000000000001", "/pinjaman-karyawan/00000000-0000-4000-8000-000000000001/cicilan/baru",
  "/piutang-customer/baru", "/piutang-customer/00000000-0000-4000-8000-000000000001", "/piutang-customer/00000000-0000-4000-8000-000000000001/pembayaran/baru",
  "/utang-supplier/baru", "/utang-supplier/00000000-0000-4000-8000-000000000001", "/utang-supplier/00000000-0000-4000-8000-000000000001/pembayaran/baru",
  "/laporan-keuangan/pdf", "/laporan-keuangan/rincian",
  "/saldo-pembukaan", "/panduan",
];

for (const route of protectedRoutes) {
  const response = await fetch(new URL(route, base), { redirect: "manual", signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 307, `${route} wajib menolak akses tanpa sesi`);
  assert.equal(new URL(response.headers.get("location"), base).pathname, "/login");
  await response.body?.cancel();
}
const response = await fetch(new URL("/login", base), { signal: AbortSignal.timeout(10000) });
assert.equal(response.status, 200);
const html = await response.text();
assert.ok(html.includes("Email admin") && html.includes("Kata sandi"));
assert.equal(response.headers.get("x-frame-options"), "DENY");
assert.equal(response.headers.get("x-content-type-options"), "nosniff");
console.info(`Lulus: ${protectedRoutes.length} route admin menolak akses tanpa sesi; login dan header keamanan tersedia. Pemeriksaan route tidak menguji koneksi Neon.`);
