-- Journal engine: no financial data inserted.
ALTER TABLE "FiscalYear" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

CREATE TYPE "JournalPostingStatus" AS ENUM ('DRAFT', 'POSTED');

CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'REVERSAL');

CREATE TABLE "JournalNumber" (
    "id" UUID NOT NULL,
    "journalNumber" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "journalNumber" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "fiscalYearId" UUID NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "postingStatus" "JournalPostingStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceType" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "reverseOfId" UUID,
    "reversalReason" VARCHAR(1000),
    "createdById" UUID NOT NULL,
    "postedById" UUID,
    "reversedById" UUID,
    "postedAt" TIMESTAMPTZ(3),
    "reversedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "description" VARCHAR(500),
    "debit" DECIMAL(20,0) NOT NULL,
    "credit" DECIMAL(20,0) NOT NULL,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalRequest" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "requestKey" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "entity" VARCHAR(32) NOT NULL,
    "entityId" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JournalNumber_journalNumber_key" ON "JournalNumber"("journalNumber");

CREATE UNIQUE INDEX "JournalEntry_journalNumber_key" ON "JournalEntry"("journalNumber");

CREATE UNIQUE INDEX "JournalEntry_reverseOfId_key" ON "JournalEntry"("reverseOfId");

CREATE INDEX "JournalEntry_postingStatus_date_postedAt_id_idx" ON "JournalEntry"("postingStatus", "date", "postedAt", "id");

CREATE INDEX "JournalEntry_fiscalYearId_status_date_idx" ON "JournalEntry"("fiscalYearId", "status", "date");

CREATE INDEX "JournalLine_accountId_entryId_idx" ON "JournalLine"("accountId", "entryId");

CREATE UNIQUE INDEX "JournalLine_entryId_lineNo_key" ON "JournalLine"("entryId", "lineNo");

CREATE UNIQUE INDEX "JournalRequest_scope_key" ON "JournalRequest"("actorId", "operation", "requestKey");

CREATE INDEX "AuditEvent_entity_entityId_createdAt_idx" ON "AuditEvent"("entity", "entityId", "createdAt");

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_journalNumber_fkey" FOREIGN KEY ("journalNumber") REFERENCES "JournalNumber"("journalNumber") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reverseOfId_fkey" FOREIGN KEY ("reverseOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "JournalRequest" ADD CONSTRAINT "JournalRequest_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;


ALTER TABLE "JournalNumber" ADD CONSTRAINT "JournalNumber_format_check" CHECK ("journalNumber" ~ '^JRN-[0-9]{8}-[A-Z0-9]{12}$');
ALTER TABLE "JournalEntry"
 ADD CONSTRAINT "JournalEntry_version_check" CHECK ("version" > 0),
 ADD CONSTRAINT "JournalEntry_description_check" CHECK (LENGTH(BTRIM("description")) >= 3),
 ADD CONSTRAINT "JournalEntry_state_check" CHECK (
   ("status" = 'DRAFT' AND "postingStatus" = 'DRAFT' AND "postedAt" IS NULL AND "postedById" IS NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL)
   OR ("status" = 'POSTED' AND "postingStatus" = 'POSTED' AND "postedAt" IS NOT NULL AND "postedById" IS NOT NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL)
   OR ("status" = 'REVERSED' AND "postingStatus" = 'POSTED' AND "sourceType" = 'MANUAL' AND "postedAt" IS NOT NULL AND "postedById" IS NOT NULL
      AND "reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason")) >= 3)
 ),
 ADD CONSTRAINT "JournalEntry_source_check" CHECK (
   ("sourceType" = 'MANUAL' AND "reverseOfId" IS NULL) OR
   ("sourceType" = 'REVERSAL' AND "reverseOfId" IS NOT NULL AND "reverseOfId" <> "id" AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason")) >= 3)
 );
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_amount_check" CHECK (
 "lineNo" > 0 AND (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0))
);
ALTER TABLE "JournalRequest" ADD CONSTRAINT "JournalRequest_hash_check" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_version_check" CHECK ("version" > 0);

CREATE FUNCTION "journal_header_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE fiscal "FiscalYear"%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF OLD."postingStatus" = 'POSTED' THEN RAISE EXCEPTION 'Jurnal terposting tidak dapat dihapus.' USING ERRCODE='23514'; END IF;
   SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=OLD."fiscalYearId" FOR SHARE;
   IF fiscal."status" <> 'OPEN' THEN RAISE EXCEPTION 'Periode terkunci.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS (SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=OLD."id" AND "action"='DELETED_DRAFT') THEN
     RAISE EXCEPTION 'Audit penghapusan wajib ada.' USING ERRCODE='23514';
   END IF;
   RETURN OLD;
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."journalNumber" IS DISTINCT FROM OLD."journalNumber"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType" OR NEW."reverseOfId" IS DISTINCT FROM OLD."reverseOfId" THEN
     RAISE EXCEPTION 'Identitas dan nomor jurnal tetap.' USING ERRCODE='23514';
   END IF;
   IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'Versi jurnal harus meningkat satu.' USING ERRCODE='23514'; END IF;
   IF OLD."postingStatus"='POSTED' THEN
     IF OLD."status"<>'POSTED' OR NEW."status"<>'REVERSED' OR
       (to_jsonb(NEW)-ARRAY['status','reversedAt','reversedById','reversalReason','version','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','reversedAt','reversedById','reversalReason','version','updatedAt']) THEN
       RAISE EXCEPTION 'Jurnal terposting immutable; gunakan pembalik.' USING ERRCODE='23514';
     END IF;
     RETURN NEW;
   END IF;
   SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=OLD."fiscalYearId" FOR SHARE;
   IF fiscal."status"<>'OPEN' THEN RAISE EXCEPTION 'Periode asal terkunci.' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=NEW."fiscalYearId" FOR SHARE;
 IF NOT FOUND OR fiscal."status"<>'OPEN' OR NEW."date"<fiscal."startDate" OR NEW."date">fiscal."endDate" THEN
   RAISE EXCEPTION 'Tahun/tanggal jurnal tidak sah atau periode terkunci.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "JournalEntry_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION "journal_header_guard"();

CREATE FUNCTION "journal_line_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "JournalEntry"%ROWTYPE; acc "Account"%ROWTYPE; fiscal "FiscalYear"%ROWTYPE; target UUID;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."entryId"<>OLD."entryId" OR NEW."id"<>OLD."id") THEN RAISE EXCEPTION 'Identitas baris jurnal tetap.' USING ERRCODE='23514'; END IF;
 target := CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
 SELECT * INTO parent FROM "JournalEntry" WHERE "id"=target FOR UPDATE;
 IF NOT FOUND AND TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF parent."postingStatus"='POSTED' THEN RAISE EXCEPTION 'Baris jurnal terposting immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=parent."fiscalYearId" FOR SHARE;
 IF fiscal."status"<>'OPEN' THEN RAISE EXCEPTION 'Periode terkunci.' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT * INTO acc FROM "Account" WHERE "id"=NEW."accountId" FOR UPDATE;
 IF acc."isControlAccount" THEN RAISE EXCEPTION 'Akun kontrol diblokir untuk jurnal manual tanpa subledger.' USING ERRCODE='23514'; END IF;
 IF parent."sourceType"<>'REVERSAL' AND (NOT acc."isActive" OR (acc."requiresReview" AND acc."reviewedAt" IS NULL)) THEN
   RAISE EXCEPTION 'Akun nonaktif atau belum direview.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "JournalLine_guard" BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION "journal_line_guard"();

CREATE FUNCTION "journal_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; e "JournalEntry"%ROWTYPE; origin "JournalEntry"%ROWTYPE; n BIGINT; d NUMERIC; c NUMERIC;
BEGIN
 IF TG_TABLE_NAME='JournalLine' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
 ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD."id" ELSE NEW."id" END; END IF;
 SELECT * INTO e FROM "JournalEntry" WHERE "id"=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT COUNT(*),COALESCE(SUM("debit"),0),COALESCE(SUM("credit"),0) INTO n,d,c FROM "JournalLine" WHERE "entryId"=e."id";
 IF n<2 OR n>100 THEN RAISE EXCEPTION 'Jurnal wajib memiliki 2 sampai 100 baris.' USING ERRCODE='23514'; END IF;
 IF EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId"=e."id" AND NOT EXISTS (
   SELECT 1 FROM "AccountUsage" u WHERE u."accountId"=l."accountId" AND u."sourceType"='JOURNAL' AND u."sourceId"=e."id"::text
 )) THEN RAISE EXCEPTION 'Marker pemakaian akun wajib ada.' USING ERRCODE='23514'; END IF;
 IF e."postingStatus"='POSTED' THEN
   IF d<=0 OR d<>c THEN RAISE EXCEPTION 'Debit dan kredit harus seimbang dan positif.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS (SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=e."id" AND "action" IN ('POSTED','POSTED_REVERSAL')) THEN
     RAISE EXCEPTION 'Audit posting wajib ada.' USING ERRCODE='23514';
   END IF;
 END IF;
 IF e."status"='REVERSED' AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."reverseOfId"=e."id" AND r."postingStatus"='POSTED') THEN
   RAISE EXCEPTION 'Jurnal dibatalkan harus memiliki pembalik terposting.' USING ERRCODE='23514';
 END IF;
 IF e."sourceType"='REVERSAL' THEN
   SELECT * INTO origin FROM "JournalEntry" WHERE "id"=e."reverseOfId";
   IF e."postingStatus"<>'POSTED' OR origin."status"<>'REVERSED' OR origin."sourceType"<>'MANUAL' OR e."date"<origin."date" THEN
     RAISE EXCEPTION 'Pasangan pembalikan/tanggal tidak sah.' USING ERRCODE='23514';
   END IF;
   IF n<>(SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=origin."id") OR EXISTS (
     SELECT 1 FROM "JournalLine" l LEFT JOIN "JournalLine" o ON o."entryId"=origin."id" AND o."lineNo"=l."lineNo"
     WHERE l."entryId"=e."id" AND (o."id" IS NULL OR o."accountId"<>l."accountId" OR o."debit"<>l."credit" OR o."credit"<>l."debit")
   ) THEN RAISE EXCEPTION 'Pembalik harus menukar seluruh debit dan kredit jurnal asal.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "JournalEntry_final_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_final_check"();
CREATE CONSTRAINT TRIGGER "JournalLine_final_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_final_check"();

CREATE FUNCTION "fiscal_year_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "JournalEntry" WHERE "fiscalYearId"=OLD."id") THEN
   IF TG_OP='DELETE' OR NEW."year"<>OLD."year" OR NEW."startDate"<>OLD."startDate" OR NEW."endDate"<>OLD."endDate" THEN
     RAISE EXCEPTION 'Tahun buku yang dipakai tidak dapat dihapus/diubah tanggalnya.' USING ERRCODE='23514';
   END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW."version"<>OLD."version"+1 THEN RAISE EXCEPTION 'Versi tahun buku harus meningkat.' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FiscalYear_guard" BEFORE UPDATE OR DELETE ON "FiscalYear" FOR EACH ROW EXECUTE FUNCTION "fiscal_year_guard"();

-- Preserve use-history for archived accounts copied by an exact linked reversal.
CREATE OR REPLACE FUNCTION "record_account_usage"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE linked_reversal BOOLEAN;
BEGIN
 SELECT EXISTS (
   SELECT 1 FROM "JournalEntry" r JOIN "JournalLine" o ON o."entryId"=r."reverseOfId" AND o."accountId"=NEW."accountId"
   WHERE NEW."sourceType"='JOURNAL' AND r."id"::text=NEW."sourceId" AND r."sourceType"='REVERSAL'
 ) INTO linked_reversal;
 UPDATE "Account" SET "usedAt"=COALESCE("usedAt",NEW."createdAt"),"version"="version"+1,"updatedAt"=CURRENT_TIMESTAMP
 WHERE "id"=NEW."accountId" AND (("isActive" AND (NOT "requiresReview" OR "reviewedAt" IS NOT NULL)) OR linked_reversal);
 IF NOT FOUND THEN RAISE EXCEPTION 'Akun tidak tersedia/aktif atau belum direview.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AuditEvent_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();
CREATE TRIGGER "JournalRequest_append_only" BEFORE UPDATE OR DELETE ON "JournalRequest" FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();
CREATE TRIGGER "JournalNumber_append_only" BEFORE UPDATE OR DELETE ON "JournalNumber" FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();

