import { z } from "zod";

type Environment = Readonly<Record<string, string | undefined>>;
type DatabaseVariable = "DATABASE_URL" | "DIRECT_URL";

export class EnvironmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigurationError";
  }
}

const placeholder = /REPLACE_WITH|YOUR[_-]|ep-example|\[.*\]|<.*>|CHANGEME/i;

function invalid(variable: string, requirement: string): never {
  // Deliberately exclude the supplied value and parsing errors from the message.
  throw new EnvironmentConfigurationError(`${variable}: ${requirement}`);
}

export function parseNeonUrl(value: string | undefined, variable: DatabaseVariable): string {
  if (!value || value !== value.trim() || placeholder.test(value)) {
    invalid(variable, "isi URL Neon asli untuk lingkungan tujuan; placeholder tidak dapat digunakan.");
  }

  const parsed = z.url().safeParse(value);
  if (!parsed.success) {
    invalid(variable, "format URL Neon tidak sah.");
  }

  let url: URL;
  try {
    url = new URL(parsed.data);
  } catch {
    invalid(variable, "format URL Neon tidak sah.");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    invalid(variable, "wajib menggunakan Neon PostgreSQL.");
  }
  if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/i.test(url.hostname)) {
    invalid(variable, "gunakan hostname resmi dari Connection Details Neon, bukan database lokal.");
  }
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    invalid(variable, "encoding credential database tidak sah.");
  }
  if (!username || !password || /^USER$/i.test(username) || /^PASSWORD$/i.test(password) || placeholder.test(username) || placeholder.test(password)) {
    invalid(variable, "username dan password database wajib diisi dari Neon.");
  }
  if (url.pathname === "/" || !url.pathname || url.hash) {
    invalid(variable, "nama database wajib tersedia dan URL tidak boleh berisi fragment.");
  }
  if (url.searchParams.getAll("sslmode").length !== 1 || !["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")) {
    invalid(variable, "URL wajib menggunakan TLS melalui sslmode=require atau verifikasi yang lebih ketat.");
  }
  if (url.searchParams.get("sslaccept") === "accept_invalid_certs") {
    invalid(variable, "konfigurasi TLS tidak aman tidak diperbolehkan.");
  }

  const pooled = url.hostname.split(".")[0]?.endsWith("-pooler");
  if (variable === "DATABASE_URL" && !pooled) {
    invalid(variable, "runtime wajib menggunakan URL pooled Neon.");
  }
  if (variable === "DIRECT_URL" && pooled) {
    invalid(variable, "Prisma CLI wajib menggunakan URL direct/non-pooled Neon.");
  }

  return value;
}

export function getRuntimeDatabaseEnv(environment: Environment = process.env) {
  return { DATABASE_URL: parseNeonUrl(environment.DATABASE_URL, "DATABASE_URL") };
}

export function getDirectDatabaseUrl(environment: Environment = process.env) {
  return parseNeonUrl(environment.DIRECT_URL, "DIRECT_URL");
}

export function parseAuthEnv(environment: Environment = process.env) {
  const secret = environment.AUTH_SECRET;
  if (!secret || secret.length < 32 || placeholder.test(secret) || new Set(secret).size < 12) {
    invalid("AUTH_SECRET", "gunakan secret acak kuat minimal 32 karakter; placeholder ditolak.");
  }

  const originValue = environment.APP_ORIGIN;
  if (!originValue || placeholder.test(originValue)) {
    invalid("APP_ORIGIN", "isi origin aplikasi yang dipercaya.");
  }
  let origin: URL;
  try {
    origin = new URL(originValue);
  } catch {
    invalid("APP_ORIGIN", "format origin aplikasi tidak sah.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  if (
    origin.username || origin.password || origin.search || origin.hash ||
    origin.pathname !== "/" ||
    (origin.protocol !== "https:" && !(origin.protocol === "http:" && local && environment.NODE_ENV !== "production"))
  ) {
    invalid("APP_ORIGIN", "gunakan origin HTTPS tanpa path; HTTP localhost hanya untuk development.");
  }

  return { AUTH_SECRET: secret, APP_ORIGIN: origin.origin };
}
