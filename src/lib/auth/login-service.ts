import { loginSchema } from "./validation";

type LoginAdmin = { id: string; email: string; passwordHash: string };

export type LoginDependencies = {
  reserveAttempt: () => Promise<boolean>;
  findAdmin: (email: string) => Promise<LoginAdmin | null>;
  verifyPassword: (password: string, passwordHash: string | null) => Promise<boolean>;
  establishSession: (adminId: string) => Promise<void>;
  clearAttempts: () => Promise<void>;
};

export type LoginResult = { ok: true } | { ok: false; error: string };

const INVALID_CREDENTIALS = "Email atau kata sandi tidak sesuai.";

export async function authenticateAdmin(input: unknown, dependencies: LoginDependencies): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: INVALID_CREDENTIALS };

  if (!await dependencies.reserveAttempt()) {
    return { ok: false, error: "Terlalu banyak percobaan. Coba lagi dalam 15 menit." };
  }

  const admin = await dependencies.findAdmin(parsed.data.email);
  const passwordMatches = await dependencies.verifyPassword(parsed.data.password, admin?.passwordHash ?? null);
  if (!admin || !passwordMatches) return { ok: false, error: INVALID_CREDENTIALS };

  await dependencies.establishSession(admin.id);
  await dependencies.clearAttempts();
  return { ok: true };
}
