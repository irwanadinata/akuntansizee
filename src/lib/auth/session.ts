import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/lib/db";
import { getAuthEnv } from "@/lib/env/server";
import {
  hashSessionToken,
  isSessionToken,
  newSessionToken,
  SESSION_DURATION_MS,
  sessionCookieName,
  sessionCookieOptions,
} from "./token";

export type AdminIdentity = { id: string; email: string };

export async function getAdminSession(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(sessionCookieName(process.env.NODE_ENV === "production"))?.value;
  if (!token || !isSessionToken(token)) return null;

  try {
    const session = await getPrisma().adminSession.findUnique({
      where: { tokenHash: hashSessionToken(token, getAuthEnv().AUTH_SECRET) },
      select: { expiresAt: true, admin: { select: { id: true, email: true } } },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    return session.admin;
  } catch {
    // Prevent Next's error logger from recording raw adapter/connection errors.
    throw new Error("Pemeriksaan sesi belum tersedia. Coba lagi.");
  }
}

export async function requireAdmin(): Promise<AdminIdentity> {
  const admin = await getAdminSession();
  if (!admin) redirect("/login");
  return admin;
}

export async function establishAdminSession(adminId: string): Promise<void> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const tokenHash = hashSessionToken(token, getAuthEnv().AUTH_SECRET);
  try {
    await getPrisma().adminSession.create({ data: { adminId, tokenHash, expiresAt } });
  } catch {
    throw new Error("Sesi masuk belum dapat dibuat. Coba lagi.");
  }
  const production = process.env.NODE_ENV === "production";
  (await cookies()).set(sessionCookieName(production), token, sessionCookieOptions(production, expiresAt));
}

export async function revokeAdminSession(adminId: string): Promise<void> {
  const cookieStore = await cookies();
  const production = process.env.NODE_ENV === "production";
  const name = sessionCookieName(production);
  const token = cookieStore.get(name)?.value;
  if (token && isSessionToken(token)) {
    try {
      await getPrisma().adminSession.deleteMany({
        where: { adminId, tokenHash: hashSessionToken(token, getAuthEnv().AUTH_SECRET) },
      });
    } catch {
      throw new Error("Sesi belum dapat diakhiri. Coba lagi.");
    }
  }
  cookieStore.set(name, "", { ...sessionCookieOptions(production, new Date(0)), maxAge: 0 });
}
