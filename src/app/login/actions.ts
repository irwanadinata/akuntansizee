"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getAuthEnv } from "@/lib/env/server";
import { authenticateAdmin } from "@/lib/auth/login-service";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import { establishAdminSession, requireAdmin, revokeAdminSession } from "@/lib/auth/session";
import { clearLoginAttempts, reserveLoginAttempt } from "@/lib/auth/throttle";

export type LoginActionState = { error: string } | null;

export async function loginAction(input: unknown): Promise<LoginActionState> {
  let result;
  try {
    assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
    result = await authenticateAdmin(input, {
      reserveAttempt: reserveLoginAttempt,
      findAdmin: (email) => getPrisma().adminUser.findUnique({
        where: { email },
        select: { id: true, email: true, passwordHash: true },
      }),
      verifyPassword,
      establishSession: establishAdminSession,
      clearAttempts: clearLoginAttempts,
    });
  } catch {
    // Do not serialize database errors or env values into the browser response.
    return { error: "Layanan masuk belum tersedia. Hubungi pengelola aplikasi." };
  }

  if (!result.ok) return { error: result.error };
  redirect("/");
}

export async function logout(): Promise<void> {
  assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
  const admin = await requireAdmin();
  try {
    await revokeAdminSession(admin.id);
  } catch {
    throw new Error("Belum dapat keluar dari aplikasi. Coba lagi.");
  }
  redirect("/login");
}
