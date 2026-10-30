import { createHmac, randomBytes } from "node:crypto";

export const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(`zee:session:${token}`).digest("hex");
}

export function loginThrottleKey(secret: string): string {
  // One shared limit protects the only admin, including attempts using unknown emails.
  return createHmac("sha256", secret).update("zee:login:single-admin").digest("hex");
}

export function sessionCookieOptions(production: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  };
}

export function sessionCookieName(production: boolean): string {
  return production ? "__Host-zee_session" : "zee_session";
}
