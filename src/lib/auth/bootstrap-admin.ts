import { initialAdminSchema } from "./validation";
import { hashPassword } from "./password";
import { parseAuthEnv } from "../env/validation";

export type AdminBootstrapStore = {
  findAdmin(): Promise<{ id: string } | null>;
  createAdmin(data: { email: string; passwordHash: string; singletonKey: number }): Promise<{ id: string }>;
};
export async function ensureSeedAdmin(store: AdminBootstrapStore, environment: Record<string, string | undefined> = process.env) {
  const existing = await store.findAdmin();
  if (existing) return { id: existing.id, created: false }; // Never reset an existing credential.
  parseAuthEnv(environment);
  const input = initialAdminSchema.safeParse({ email: environment.SEED_ADMIN_EMAIL, password: environment.SEED_ADMIN_PASSWORD });
  if (!input.success) throw new Error("Admin belum ada: isi SEED_ADMIN_EMAIL/password kuat dan AUTH_SECRET valid dari env. Placeholder ditolak.");
  const admin = await store.createAdmin({ email: input.data.email, passwordHash: await hashPassword(input.data.password), singletonKey: 1 });
  return { id: admin.id, created: true };
}

