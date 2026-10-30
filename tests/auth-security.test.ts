import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedOrigin } from "../src/lib/auth/origin";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import {
  hashSessionToken,
  isSessionToken,
  loginThrottleKey,
  newSessionToken,
  SESSION_DURATION_MS,
  sessionCookieName,
  sessionCookieOptions,
} from "../src/lib/auth/token";
import { initialAdminSchema, loginSchema } from "../src/lib/auth/validation";
import { LOGIN_ATTEMPT_LIMIT, mayVerifyPassword } from "../src/lib/auth/throttle-policy";

test("session tokens have 256-bit random inputs and hashes change with token/secret", () => {
  const tokens = Array.from({ length: 128 }, () => newSessionToken());
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) assert.equal(isSessionToken(token), true);
  assert.equal(isSessionToken("short"), false);
  assert.equal(isSessionToken("/".repeat(43)), false);
  assert.notEqual(hashSessionToken(tokens[0], "secret-a"), tokens[0]);
  assert.notEqual(hashSessionToken(tokens[0], "secret-a"), hashSessionToken(tokens[1], "secret-a"));
  assert.notEqual(hashSessionToken(tokens[0], "secret-a"), hashSessionToken(tokens[0], "secret-b"));
  assert.notEqual(loginThrottleKey("secret-a"), hashSessionToken(tokens[0], "secret-a"));
});

test("production cookie uses host scope, HttpOnly, Secure, SameSite and an eight-hour expiry", () => {
  const expires = new Date("2026-10-28T12:00:00Z");
  const options = sessionCookieOptions(true, expires);
  assert.deepEqual(options, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires, maxAge: SESSION_DURATION_MS / 1000 });
  assert.equal(sessionCookieName(true), "__Host-zee_session");
  assert.equal(sessionCookieOptions(false, expires).secure, false);
});

test("actions accept only configured same origin, including port", () => {
  assert.doesNotThrow(() => assertTrustedOrigin("https://keuangan.zee.test", "https://keuangan.zee.test"));
  for (const origin of [null, "null", "http://keuangan.zee.test", "https://evil.test", "https://keuangan.zee.test:444", "https://keuangan.zee.test.evil.test"]) {
    assert.throws(() => assertTrustedOrigin(origin, "https://keuangan.zee.test"));
  }
});

test("password validation never trims passwords or silently truncates bcrypt multibyte input", () => {
  const input = loginSchema.parse({ email: " ADMIN@ZEE.TEST ", password: "  Abc12345  " });
  assert.equal(input.email, "admin@zee.test");
  assert.equal(input.password, "  Abc12345  ");
  assert.equal(loginSchema.safeParse({ email: "admin@zee.test", password: "é".repeat(37) }).success, false);
  assert.equal(loginSchema.safeParse({ email: "admin@zee.test", password: "é".repeat(36) }).success, true);
  for (const password of ["REPLACE_WITH_STRONG_SECRET", "Password123!", "short", "alllowercase12!", "A".repeat(73)]) {
    assert.equal(initialAdminSchema.safeParse({ email: "admin@zee.test", password }).success, false);
  }
  assert.equal(initialAdminSchema.safeParse({ email: "admin@zee.test", password: "New-Synthetic!73Q" }).success, true);
});

test("bcrypt cost 12 verifies exact credentials and rejects unknown-account dummy comparison", async () => {
  const hash = await hashPassword("Synthetic-Only!47");
  assert.match(hash, /^\$2[ab]\$12\$/);
  assert.equal(await verifyPassword("Synthetic-Only!47", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(await verifyPassword("Synthetic-Only!47", null), false);
});

test("throttle refuses the sixth reserved attempt and any active lock", () => {
  const now = new Date("2026-10-28T03:00:00Z");
  assert.equal(mayVerifyPassword({ attempts: LOGIN_ATTEMPT_LIMIT, blockedUntil: null }, now), true);
  assert.equal(mayVerifyPassword({ attempts: LOGIN_ATTEMPT_LIMIT + 1, blockedUntil: null }, now), false);
  assert.equal(mayVerifyPassword({ attempts: 1, blockedUntil: new Date(now.getTime() + 1) }, now), false);
  assert.equal(mayVerifyPassword({ attempts: 1, blockedUntil: now }, now), true);
});
