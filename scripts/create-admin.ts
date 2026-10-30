import { createDirectPrismaClient } from "../src/lib/db-core";
import { EnvironmentConfigurationError, parseAuthEnv } from "../src/lib/env/validation";
import { hashPassword } from "../src/lib/auth/password";
import { initialAdminSchema } from "../src/lib/auth/validation";
import { loadLocalEnv } from "./load-env";

class AdminInputError extends Error {}

async function main() {
  loadLocalEnv();
  parseAuthEnv(process.env);
  const input = initialAdminSchema.safeParse({
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  if (!input.success) {
    // Only messages declared by our validators are included, never supplied values.
    const messages = input.error.issues.map((issue) => {
      const variable = issue.path[0] === "email" ? "SEED_ADMIN_EMAIL" : "SEED_ADMIN_PASSWORD";
      return `${variable}: ${issue.code === "invalid_type" ? "wajib diisi." : issue.message}`;
    });
    throw new AdminInputError(messages.join(" "));
  }

  const passwordHash = await hashPassword(input.data.password);
  const db = createDirectPrismaClient();
  try {
    const created = await db.$transaction(async (tx) => {
      // Serializes bootstrap across CLI processes; DB UNIQUE/CHECK also enforce exactly one admin.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(726069455)::text`;
      const existing = await tx.adminUser.findUnique({ where: { singletonKey: 1 }, select: { id: true } });
      if (existing) return false;
      await tx.adminUser.create({ data: { email: input.data.email, passwordHash, singletonKey: 1 } });
      return true;
    });
    console.info(created ? "Admin berhasil dibuat. Tidak ada COA, jurnal, atau transaksi dibuat." : "Admin sudah ada. Akun dan kata sandi tidak diubah.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // These two error types contain only our own validation messages.
  // Raw driver errors can contain credentials. Never print other error details.
  const reason = error instanceof EnvironmentConfigurationError || error instanceof AdminInputError
    ? error.message
    : "Periksa koneksi/izin Neon dan tabel hasil migrasi pada database tujuan. Untuk production, gunakan npm run db:migrate:deploy.";
  console.error(`Inisialisasi admin gagal. ${reason} Tidak ada seed COA dijalankan.`);
  process.exitCode = 1;
});
