import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixture = {
  NODE_ENV: "production" as const,
  AUTH_SECRET: "unit-test-only-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789",
  APP_ORIGIN: "https://keuangan.zee.test",
  SEED_ADMIN_EMAIL: "admin@zee.test",
  SEED_ADMIN_PASSWORD: "New-Synthetic!73Q",
  DIRECT_URL: "postgresql://test_admin:test-only-value@ep-unit-123456.ap-southeast-1.aws.neon.tech/unit_test?sslmode=require",
};

function runInvalidConfiguration(overrides: Record<string, string>) {
  // Invalid configurations must fail before any database connection is attempted.
  return spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/create-admin.ts"], {
    env: { ...process.env, ...fixture, ...overrides },
    encoding: "utf8",
    timeout: 15000,
  });
}

test("admin CLI explains weak password rules without printing credentials", () => {
  const password = "private-lowercase-73!";
  const result = runInvalidConfiguration({ SEED_ADMIN_PASSWORD: password });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SEED_ADMIN_PASSWORD:.*huruf besar, huruf kecil, angka, dan simbol/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(fixture.DIRECT_URL));
});

test("admin CLI explains invalid production origin without echoing its value", () => {
  const origin = "http://private-origin.zee.test";
  const result = runInvalidConfiguration({ APP_ORIGIN: origin });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APP_ORIGIN:.*HTTPS/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(origin));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(fixture.SEED_ADMIN_PASSWORD));
});

test("admin CLI explains direct URL configuration without exposing credentials", () => {
  const url = "postgresql://user:private-do-not-echo@localhost/app";
  const result = runInvalidConfiguration({ DIRECT_URL: url });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DIRECT_URL:/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(url));
  assert.ok(!`${result.stdout}${result.stderr}`.includes("private-do-not-echo"));
});
