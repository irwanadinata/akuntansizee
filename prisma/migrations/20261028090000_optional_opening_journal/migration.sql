-- Schema/guards only. No opening amounts, journals, accounts or sample data.
CREATE TABLE "OpeningJournal" (
  "id" UUID NOT NULL,
  "singletonKey" INTEGER NOT NULL DEFAULT 1,
  "journalEntryId" UUID NOT NULL,
  "cutoverDate" DATE NOT NULL,
  "fiscalYearId" UUID NOT NULL,
  "verificationNote" VARCHAR(1000) NOT NULL,
  "previewHash" CHAR(64) NOT NULL,
  "createdById" UUID NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpeningJournal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpeningJournal_values_check" CHECK ("singletonKey"=1 AND LENGTH(BTRIM("verificationNote"))>=10 AND "previewHash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "OpeningJournal_singletonKey_key" ON "OpeningJournal"("singletonKey");
CREATE UNIQUE INDEX "OpeningJournal_journalEntryId_key" ON "OpeningJournal"("journalEntryId");
ALTER TABLE "OpeningJournal" ADD CONSTRAINT "OpeningJournal_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OpeningJournal" ADD CONSTRAINT "OpeningJournal_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "OpeningJournal" ADD CONSTRAINT "OpeningJournal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION "opening_history_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE fiscal "FiscalYear"%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Penanda saldo pembukaan tidak dapat diubah/dihapus; gunakan koreksi jurnal.' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('zee:opening-cutover',0));
  SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=NEW."fiscalYearId" FOR SHARE;
  IF NOT FOUND OR fiscal."status"<>'OPEN' OR NEW."cutoverDate"<fiscal."startDate" OR NEW."cutoverDate">fiscal."endDate" THEN
    RAISE EXCEPTION 'Cutover harus berada pada Tahun Buku terbuka yang dipilih.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM "JournalEntry" WHERE "postingStatus"='POSTED' AND "date"<NEW."cutoverDate") THEN
    RAISE EXCEPTION 'Sudah ada jurnal terposting sebelum cutover.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "OpeningJournal_history_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OpeningJournal" FOR EACH ROW EXECUTE FUNCTION "opening_history_guard"();

-- Shared/exclusive barrier serializes initialization against all actual postings,
-- including direct SQL, without serializing normal postings with each other.
CREATE FUNCTION "journal_cutover_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cutover DATE;
BEGIN
  IF NEW."postingStatus"<>'POSTED' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD."postingStatus"='POSTED' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('zee:opening-cutover',0));
  SELECT "cutoverDate" INTO cutover FROM "OpeningJournal" WHERE "singletonKey"=1;
  IF cutover IS NOT NULL AND NEW."date"<cutover THEN
    RAISE EXCEPTION 'Posting sebelum tanggal cutover saldo pembukaan ditolak.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "JournalEntry_00_cutover_guard" BEFORE INSERT OR UPDATE OF "date","postingStatus" ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION "journal_cutover_guard"();

CREATE FUNCTION "opening_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE marker "OpeningJournal"%ROWTYPE; entry "JournalEntry"%ROWTYPE; target UUID;
BEGIN
  IF TG_TABLE_NAME='OpeningJournal' THEN target:=NEW."journalEntryId"; ELSE target:=NEW."id"; END IF;
  SELECT * INTO marker FROM "OpeningJournal" WHERE "journalEntryId"=target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO entry FROM "JournalEntry" WHERE "id"=target;
  IF entry."postingStatus"<>'POSTED' OR entry."sourceType"<>'MANUAL' OR entry."reverseOfId" IS NOT NULL
    OR entry."date"<>marker."cutoverDate" OR entry."fiscalYearId"<>marker."fiscalYearId"
    OR entry."createdById"<>marker."createdById" OR entry."postedById"<>marker."createdById" THEN
    RAISE EXCEPTION 'Jurnal pembukaan harus terposting dan sesuai tanggal/tahun/admin konfirmasi.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='OPENING' AND "entityId"=marker."id" AND "actorId"=marker."createdById" AND "action"='OPENING_POSTED' AND "details"->>'confirmed'='true') THEN
    RAISE EXCEPTION 'Audit konfirmasi saldo pembukaan wajib ada.' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='OpeningJournal' THEN
    IF EXISTS(SELECT 1 FROM "JournalLine" l JOIN "Account" a ON a."id"=l."accountId" WHERE l."entryId"=target AND (a."isControlAccount" OR NOT a."isActive" OR a."reviewedAt" IS NULL)) THEN
      RAISE EXCEPTION 'Pembukaan hanya untuk akun aktif, disetujui dan tanpa akun kontrol manual.' USING ERRCODE='23514';
    END IF;
    IF (SELECT COUNT(*)<>COUNT(DISTINCT "accountId") FROM "JournalLine" WHERE "entryId"=target) THEN
      RAISE EXCEPTION 'Saldo pembukaan per akun wajib neto, tanpa akun berulang.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "OpeningJournal_final_check" AFTER INSERT ON "OpeningJournal" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "opening_final_check"();
CREATE CONSTRAINT TRIGGER "JournalEntry_opening_check" AFTER INSERT OR UPDATE ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "opening_final_check"();
