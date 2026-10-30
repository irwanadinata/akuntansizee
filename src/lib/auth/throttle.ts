import "server-only";
import { getPrisma } from "@/lib/db";
import { getAuthEnv } from "@/lib/env/server";
import { loginThrottleKey } from "./token";
import { LOGIN_ATTEMPT_LIMIT, LOGIN_WINDOW_MS, mayVerifyPassword, type ThrottleState } from "./throttle-policy";

export async function reserveLoginAttempt(now = new Date()): Promise<boolean> {
  const key = loginThrottleKey(getAuthEnv().AUTH_SECRET);
  const cutoff = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const lockUntil = new Date(now.getTime() + LOGIN_WINDOW_MS);
  const db = getPrisma();

  // The UPSERT takes a row lock: concurrent requests share one atomic budget across app instances.
  const rows = await db.$queryRaw<ThrottleState[]>`
    INSERT INTO "LoginThrottle" ("key", "attempts", "windowStartedAt", "blockedUntil")
    VALUES (${key}, 1, ${now}, NULL)
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE
        WHEN "LoginThrottle"."windowStartedAt" <= ${cutoff}
          AND ("LoginThrottle"."blockedUntil" IS NULL OR "LoginThrottle"."blockedUntil" <= ${now}) THEN 1
        ELSE LEAST("LoginThrottle"."attempts" + 1, ${LOGIN_ATTEMPT_LIMIT + 1}) END,
      "windowStartedAt" = CASE
        WHEN "LoginThrottle"."windowStartedAt" <= ${cutoff}
          AND ("LoginThrottle"."blockedUntil" IS NULL OR "LoginThrottle"."blockedUntil" <= ${now}) THEN ${now}
        ELSE "LoginThrottle"."windowStartedAt" END,
      "blockedUntil" = CASE
        WHEN "LoginThrottle"."blockedUntil" > ${now} THEN "LoginThrottle"."blockedUntil"
        WHEN "LoginThrottle"."windowStartedAt" <= ${cutoff} THEN NULL
        WHEN "LoginThrottle"."attempts" >= ${LOGIN_ATTEMPT_LIMIT} THEN ${lockUntil}
        ELSE NULL END
    RETURNING "attempts", "blockedUntil"
  `;

  if (rows.length !== 1) throw new Error("Pemeriksaan akses tidak tersedia.");
  return mayVerifyPassword(rows[0], now);
}

export async function clearLoginAttempts(): Promise<void> {
  await getPrisma().loginThrottle.deleteMany({
    where: { key: loginThrottleKey(getAuthEnv().AUTH_SECRET) },
  });
}
