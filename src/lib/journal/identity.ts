import { createHash, randomBytes } from "node:crypto";
import { jakartaDate } from "../accounting/dates";
export function newJournalNumber(now = new Date()): string {
  return newPublicNumber("JRN", now);
}
export function newPublicNumber(prefix: "JRN" | "PJM" | "CIC" | "PIU" | "UTG" | "BYC" | "BYS", now = new Date()): string {
  // 48 random bits, 12 uppercase hexadecimal characters; DB uniqueness is mandatory.
  return prefix + "-" + jakartaDate(now).replace(/-/g, "") + "-" + randomBytes(6).toString("hex").toUpperCase();
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function payloadHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function isNumberCollision(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error ? error.meta : null;
  if (!meta || typeof meta !== "object") return false;
  const target = "target" in meta ? meta.target : null;
  const numberFields = ["journalNumber", "loanNumber", "documentNumber", "paymentNumber"];
  if ((Array.isArray(target) && target.length === 1 && numberFields.includes(target[0])) ||
    ["JournalEntry_journalNumber_key", "JournalNumber_journalNumber_key", "Loan_loanNumber_key", "LoanPayment_paymentNumber_key", "TradeDocument_documentNumber_key", "TradePayment_paymentNumber_key"].includes(String(target))) return true;
  // Prisma 7's Neon adapter supplies structured cause metadata instead of meta.target.
  const adapter = "driverAdapterError" in meta ? meta.driverAdapterError : null;
  const cause = adapter && typeof adapter === "object" && "cause" in adapter ? adapter.cause : null;
  if (!cause || typeof cause !== "object" || !("kind" in cause) || cause.kind !== "UniqueConstraintViolation" || !("table" in cause) ||
    !["JournalNumber", "JournalEntry", "Loan", "LoanPayment", "TradeDocument", "TradePayment"].includes(String(cause.table))) return false;
  const constraint = "constraint" in cause ? cause.constraint : null;
  const fields = constraint && typeof constraint === "object" && "fields" in constraint ? constraint.fields : null;
  const expected = cause.table === "Loan" ? "loanNumber" : cause.table === "TradeDocument" ? "documentNumber" : ["LoanPayment", "TradePayment"].includes(String(cause.table)) ? "paymentNumber" : "journalNumber";
  return Array.isArray(fields) && fields.length === 1 && [expected, '"' + expected + '"'].includes(fields[0]);
}
export async function boundedCommand<T>(run: () => Promise<T>, limit = 5): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { return await run(); }
    catch (error) {
      const serialization = error && typeof error === "object" && "code" in error && error.code === "P2034";
      if (attempt >= limit || (!isNumberCollision(error) && !serialization)) throw error;
    }
  }
}

