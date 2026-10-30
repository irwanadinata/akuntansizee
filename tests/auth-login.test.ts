import assert from "node:assert/strict";
import test from "node:test";
import { authenticateAdmin, type LoginDependencies } from "../src/lib/auth/login-service";

function setup(overrides: Partial<LoginDependencies> = {}) {
  const calls: string[] = [];
  const dependencies: LoginDependencies = {
    reserveAttempt: async () => { calls.push("reserve"); return true; },
    findAdmin: async (email) => { calls.push(`find:${email}`); return { id: "admin-id", email, passwordHash: "stored-hash" }; },
    verifyPassword: async (_password, hash) => { calls.push(`verify:${hash}`); return true; },
    establishSession: async (id) => { calls.push(`session:${id}`); },
    clearAttempts: async () => { calls.push("clear"); },
    ...overrides,
  };
  return { calls, dependencies };
}

const validInput = { email: " ADMIN@ZEE.TEST ", password: "Synthetic!123" };

test("login reserves its shared DB budget before looking up credentials and opens only an authenticated session", async () => {
  const { calls, dependencies } = setup();
  assert.deepEqual(await authenticateAdmin(validInput, dependencies), { ok: true });
  assert.deepEqual(calls, ["reserve", "find:admin@zee.test", "verify:stored-hash", "session:admin-id", "clear"]);
});

test("blocked login cannot inspect accounts or establish sessions", async () => {
  const { calls, dependencies } = setup({ reserveAttempt: async () => false });
  assert.equal((await authenticateAdmin(validInput, dependencies)).ok, false);
  assert.deepEqual(calls, []);
});

test("wrong password and missing account have identical user-facing errors; neither creates a session", async () => {
  const wrong = setup({ verifyPassword: async () => false });
  const missing = setup({ findAdmin: async () => null });
  const wrongResult = await authenticateAdmin(validInput, wrong.dependencies);
  assert.deepEqual(await authenticateAdmin(validInput, missing.dependencies), wrongResult);
  assert.equal(wrong.calls.some((call) => call.startsWith("session:")), false);
  assert.deepEqual(missing.calls, ["reserve", "verify:null"]);
});

test("untrusted malformed payload never reaches DB/session dependencies", async () => {
  const { calls, dependencies } = setup();
  assert.equal((await authenticateAdmin({ email: "not-email", password: "short" }, dependencies)).ok, false);
  assert.deepEqual(calls, []);
});

test("failed session persistence fails closed and does not clear the login budget", async () => {
  const { calls, dependencies } = setup({ establishSession: async () => { throw new Error("synthetic persistence failure"); } });
  await assert.rejects(authenticateAdmin(validInput, dependencies));
  assert.equal(calls.includes("clear"), false);
});
