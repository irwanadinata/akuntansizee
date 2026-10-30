import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "../scripts/load-env";

test("env loader honors process > .env.local > .env without rewriting source secrets", () => {
  const parent = resolve(".npm-cache");
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, "env-precedence-"));
  const key = "ZEE_SYNTHETIC_ENV_TEST";
  const existing = process.env[key];
  try {
    writeFileSync(resolve(directory, ".env"), key + "=base-synthetic\n");
    writeFileSync(resolve(directory, ".env.local"), key + "=local-synthetic\n");
    delete process.env[key]; loadLocalEnv(directory);
    assert.equal(process.env[key], "local-synthetic");
    process.env[key] = "process-synthetic"; loadLocalEnv(directory);
    assert.equal(process.env[key], "process-synthetic");
    delete process.env[key]; unlinkSync(resolve(directory, ".env.local")); loadLocalEnv(directory);
    assert.equal(process.env[key], "base-synthetic");
  } finally {
    if (existing === undefined) delete process.env[key]; else process.env[key] = existing;
    unlinkSync(resolve(directory, ".env")); rmdirSync(directory);
  }
});

