import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EnvironmentConfigurationError,
  getDirectDatabaseUrl,
  getRuntimeDatabaseEnv,
  parseAuthEnv,
  parseNeonUrl,
} from "../src/lib/env/validation";

// Deliberately fabricated structural fixtures; no connection is attempted.
const direct = "postgresql://test_admin:test-only-value@ep-unit-123456.ap-southeast-1.aws.neon.tech/unit_test?sslmode=require";
const pooled = direct.replace("ep-unit-123456.", "ep-unit-123456-pooler.");
const secret = "unit-test-only-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789";

test("runtime and CLI accept their designated Neon URL only", () => {
  assert.equal(getRuntimeDatabaseEnv({ DATABASE_URL: pooled }).DATABASE_URL, pooled);
  assert.equal(getDirectDatabaseUrl({ DIRECT_URL: direct }), direct);
  assert.throws(() => parseNeonUrl(direct, "DATABASE_URL"), /pooled/);
  assert.throws(() => parseNeonUrl(pooled, "DIRECT_URL"), /direct/);
});

test("database configuration rejects missing values, placeholders, local DB and insecure TLS", () => {
  for (const value of [undefined, "", "REPLACE_WITH_NEON_URL", "not-a-url", "postgresql://USER:PASSWORD@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=require", "postgresql://user:pass@localhost:5432/app?sslmode=require", "file:./dev.db", pooled.replace("sslmode=require", "sslmode=disable"), `${pooled}&sslmode=disable`, pooled.replace("test-only-value", "%50ASSWORD"), pooled.replace("sslmode=require", "sslmode=require&sslaccept=accept_invalid_certs")]) {
    assert.throws(() => parseNeonUrl(value, "DATABASE_URL"), EnvironmentConfigurationError);
  }
});

test("database errors never include the supplied credential or connection URL", () => {
  const unsafe = "postgresql://user:private-value-do-not-echo@localhost/app";
  assert.throws(() => parseNeonUrl(unsafe, "DATABASE_URL"), (error: unknown) => {
    assert.ok(error instanceof EnvironmentConfigurationError);
    assert.ok(!error.message.includes("private-value-do-not-echo"));
    assert.ok(!error.message.includes(unsafe));
    return true;
  });
});

test("authentication accepts localhost only for development and normalizes an HTTPS origin", () => {
  assert.deepEqual(parseAuthEnv({ AUTH_SECRET: secret, APP_ORIGIN: "http://localhost:3000", NODE_ENV: "development" }), { AUTH_SECRET: secret, APP_ORIGIN: "http://localhost:3000" });
  assert.equal(parseAuthEnv({ AUTH_SECRET: secret, APP_ORIGIN: "https://keuangan.zee.invalid/", NODE_ENV: "production" }).APP_ORIGIN, "https://keuangan.zee.invalid");
  for (const origin of [undefined, "http://localhost:3000", "http://keuangan.zee.invalid", "https://keuangan.zee.invalid/path", "https://user:password@keuangan.zee.invalid", "https://keuangan.zee.invalid/?query=value"]) {
    assert.throws(() => parseAuthEnv({ AUTH_SECRET: secret, APP_ORIGIN: origin, NODE_ENV: "production" }), EnvironmentConfigurationError);
  }
});

test("weak or placeholder auth secrets are rejected before use", () => {
  for (const value of [undefined, "", "short", "REPLACE_WITH_LONG_RANDOM_SECRET", "a".repeat(64)]) {
    assert.throws(() => parseAuthEnv({ AUTH_SECRET: value, APP_ORIGIN: "http://localhost:3000" }), /AUTH_SECRET/);
  }
});
