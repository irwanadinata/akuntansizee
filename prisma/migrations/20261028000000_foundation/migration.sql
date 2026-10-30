-- Source-only baseline, authored offline. Not applied to any Neon database.
-- No seed, COA rows, balances, business transactions, or journals are inserted.

CREATE TYPE "AccountMainType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COGS', 'EXPENSE');
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'LOCKED');

CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "singletonKey" INTEGER NOT NULL DEFAULT 1,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminUser_singleton_check" CHECK ("singletonKey" = 1),
    CONSTRAINT "AdminUser_email_normalized_check" CHECK ("email" = LOWER(BTRIM("email")) AND "email" <> '')
);

CREATE TABLE "AdminSession" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "adminId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminSession_expiry_check" CHECK ("expiresAt" > "createdAt")
);

CREATE TABLE "LoginThrottle" (
    "key" VARCHAR(100) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
    "blockedUntil" TIMESTAMPTZ(3),
    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "LoginThrottle_attempts_check" CHECK ("attempts" >= 0)
);

CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "sourceRow" INTEGER,
    "sourceCode" VARCHAR(32),
    "sourceName" VARCHAR(255),
    "sourceType" VARCHAR(100),
    "mainType" "AccountMainType" NOT NULL,
    "reportGroup" VARCHAR(100) NOT NULL,
    "normalBalance" "NormalBalance" NOT NULL,
    "isContra" BOOLEAN NOT NULL DEFAULT false,
    "isControlAccount" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Account_code_check" CHECK ("code" = BTRIM("code") AND "code" <> ''),
    CONSTRAINT "Account_name_check" CHECK (BTRIM("name") <> ''),
    CONSTRAINT "Account_source_row_check" CHECK ("sourceRow" IS NULL OR "sourceRow" > 1)
);

CREATE TABLE "FiscalYear" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FiscalYear_dates_check" CHECK (
      "startDate" <= "endDate"
      AND EXTRACT(YEAR FROM "startDate") = "year"
      AND EXTRACT(YEAR FROM "endDate") = "year"
      AND EXTRACT(MONTH FROM "startDate") = 1
      AND EXTRACT(DAY FROM "startDate") = 1
      AND EXTRACT(MONTH FROM "endDate") = 12
      AND EXTRACT(DAY FROM "endDate") = 31
    )
);

CREATE UNIQUE INDEX "AdminUser_singletonKey_key" ON "AdminUser"("singletonKey");
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");
CREATE UNIQUE INDEX "AdminSession_tokenHash_key" ON "AdminSession"("tokenHash");
CREATE INDEX "AdminSession_adminId_idx" ON "AdminSession"("adminId");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");
CREATE UNIQUE INDEX "Account_sourceRow_key" ON "Account"("sourceRow");
CREATE UNIQUE INDEX "FiscalYear_year_key" ON "FiscalYear"("year");

ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
