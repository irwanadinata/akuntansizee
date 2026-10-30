-- COA metadata and durable usage guard only; no seed rows, balances or journals.
ALTER TABLE "Account"
  ADD COLUMN "requiresReview" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewReason" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMPTZ(3),
  ADD COLUMN "usedAt" TIMESTAMPTZ(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "Account_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "Account_review_check" CHECK (NOT "requiresReview" OR "reviewedAt" IS NOT NULL OR NOT "isActive");

CREATE TABLE "AccountUsage" (
  "id" UUID NOT NULL, "accountId" UUID NOT NULL,
  "sourceType" VARCHAR(64) NOT NULL, "sourceId" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AccountUsage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountUsage_source_check" CHECK (BTRIM("sourceType") <> '' AND BTRIM("sourceId") <> '')
);
CREATE UNIQUE INDEX "AccountUsage_accountId_sourceType_sourceId_key" ON "AccountUsage"("accountId", "sourceType", "sourceId");
ALTER TABLE "AccountUsage" ADD CONSTRAINT "AccountUsage_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "CoaChange" (
  "id" UUID NOT NULL, "accountId" UUID NOT NULL, "actorId" UUID NOT NULL,
  "action" VARCHAR(16) NOT NULL, "sourceRow" INTEGER, "details" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoaChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoaChange_action_check" CHECK ("action" IN ('CREATE','UPDATE','ARCHIVE','ACTIVATE','DELETE','SEED'))
);
CREATE INDEX "CoaChange_accountId_createdAt_idx" ON "CoaChange"("accountId", "createdAt");
CREATE INDEX "CoaChange_action_sourceRow_idx" ON "CoaChange"("action", "sourceRow");
ALTER TABLE "CoaChange" ADD CONSTRAINT "CoaChange_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "protect_account_history"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."usedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "AccountUsage" WHERE "accountId" = OLD."id") THEN
      RAISE EXCEPTION 'Akun pernah digunakan; nonaktifkan akun.' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."sourceRow" IS DISTINCT FROM OLD."sourceRow"
    OR NEW."sourceCode" IS DISTINCT FROM OLD."sourceCode"
    OR NEW."sourceName" IS DISTINCT FROM OLD."sourceName"
    OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType" THEN
    RAISE EXCEPTION 'Provenance COA tidak dapat diubah.' USING ERRCODE = '23514';
  END IF;
  IF OLD."usedAt" IS NOT NULL THEN
    IF NEW."usedAt" IS DISTINCT FROM OLD."usedAt"
      OR NEW."code" IS DISTINCT FROM OLD."code"
      OR NEW."mainType" IS DISTINCT FROM OLD."mainType"
      OR NEW."reportGroup" IS DISTINCT FROM OLD."reportGroup"
      OR NEW."normalBalance" IS DISTINCT FROM OLD."normalBalance"
      OR NEW."isContra" IS DISTINCT FROM OLD."isContra"
      OR NEW."isControlAccount" IS DISTINCT FROM OLD."isControlAccount" THEN
      RAISE EXCEPTION 'Identitas/klasifikasi akun terpakai dikunci.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."version" <= OLD."version" THEN
    RAISE EXCEPTION 'Versi akun wajib meningkat.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Account_history_guard" BEFORE UPDATE OR DELETE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION "protect_account_history"();

CREATE FUNCTION "record_account_usage"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Updating the parent also serializes against COA editing/deletion.
  UPDATE "Account" SET "usedAt" = COALESCE("usedAt", NEW."createdAt"),
    "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = NEW."accountId" AND "isActive"
      AND (NOT "requiresReview" OR "reviewedAt" IS NOT NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Akun tidak tersedia/aktif atau belum direview.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "AccountUsage_mark_used" BEFORE INSERT ON "AccountUsage"
  FOR EACH ROW EXECUTE FUNCTION "record_account_usage"();

CREATE FUNCTION "coa_append_only"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Catatan pemakaian/audit COA tidak dapat diubah atau dihapus.' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "AccountUsage_append_only" BEFORE UPDATE OR DELETE ON "AccountUsage"
  FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();
CREATE TRIGGER "CoaChange_append_only" BEFORE UPDATE OR DELETE ON "CoaChange"
  FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();

