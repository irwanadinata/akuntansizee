-- Delete standalone manual journals atomically, retaining audit, usage and numbers.
CREATE FUNCTION "journal_delete_in_transaction"(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "AuditEvent" a
 WHERE a."entity"='JOURNAL' AND a."entityId"=target AND a."action"='DELETED'
 AND a."details"->>'transactionId'=txid_current()::text
 AND a."details"->'before'="journal_snapshot"(target))
$$;

CREATE FUNCTION "journal_delete_audit_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e "JournalEntry"%ROWTYPE; fiscal "FiscalYear"%ROWTYPE;
BEGIN
 IF NEW."entity"<>'JOURNAL' OR NEW."action"<>'DELETED' THEN RETURN NEW; END IF;
 SELECT * INTO e FROM "JournalEntry" WHERE "id"=NEW."entityId" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Jurnal tidak ditemukan.' USING ERRCODE='23514'; END IF;
 IF e."sourceType"<>'MANUAL' OR e."status"='REVERSED' OR e."reverseOfId" IS NOT NULL
 OR EXISTS(SELECT 1 FROM "JournalEntry" WHERE "reverseOfId"=e."id")
 OR EXISTS(SELECT 1 FROM "OpeningJournal" WHERE "journalEntryId"=e."id") THEN
   RAISE EXCEPTION 'Hanya jurnal manual tanpa saldo pembukaan, transaksi asal atau pembalik yang dapat dihapus.' USING ERRCODE='23514';
 END IF;
 SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=e."fiscalYearId" FOR SHARE;
 IF fiscal."status"<>'OPEN' THEN RAISE EXCEPTION 'Periode terkunci.' USING ERRCODE='23514'; END IF;
 IF NEW."details"->>'transactionId' IS DISTINCT FROM txid_current()::text
 OR NEW."details"->'before' IS DISTINCT FROM "journal_snapshot"(e."id")
 OR NEW."details"->>'status' IS DISTINCT FROM e."status"::text
 OR NEW."details"->>'postingStatus' IS DISTINCT FROM e."postingStatus"::text
 OR NEW."details"->>'fiscalYearId' IS DISTINCT FROM e."fiscalYearId"::text
 OR LENGTH(BTRIM(COALESCE(NEW."details"->>'reason','')))<3
 OR LENGTH(NEW."details"->>'reason')>1000
 OR "journal_edit_in_transaction"(e."id")
 OR EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=e."id" AND "action"='DELETED') THEN
   RAISE EXCEPTION 'Audit penghapusan wajib sesuai jurnal, alasan dan transaksi saat ini.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AuditEvent_journal_delete_guard" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "journal_delete_audit_guard"();

CREATE FUNCTION "journal_delete_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."entity"='JOURNAL' AND NEW."action"='DELETED'
 AND EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=NEW."entityId") THEN
   RAISE EXCEPTION 'Audit penghapusan wajib disimpan bersama penghapusan jurnal.' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "AuditEvent_journal_delete_check" AFTER INSERT ON "AuditEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_delete_final_check"();

-- Retain every existing insert/update guard; replace only the deletion rule.
CREATE OR REPLACE FUNCTION "journal_header_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE fiscal "FiscalYear"%ROWTYPE;
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF NOT "journal_delete_in_transaction"(OLD."id") THEN
     RAISE EXCEPTION 'Penghapusan jurnal memerlukan audit yang sesuai dalam transaksi yang sama.' USING ERRCODE='23514';
   END IF;
   SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=OLD."fiscalYearId" FOR SHARE;
   IF fiscal."status"<>'OPEN' THEN RAISE EXCEPTION 'Periode terkunci.' USING ERRCODE='23514'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP = 'UPDATE' THEN
   IF NEW."id" IS DISTINCT FROM OLD."id" OR (NEW."journalNumber" IS DISTINCT FROM OLD."journalNumber" AND NOT "journal_edit_in_transaction"(OLD."id"))
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType" OR NEW."reverseOfId" IS DISTINCT FROM OLD."reverseOfId" THEN
     RAISE EXCEPTION 'Identitas jurnal tetap; perubahan nomor memerlukan audit.' USING ERRCODE='23514';
   END IF;
   IF NEW."version" <> OLD."version" + 1 THEN RAISE EXCEPTION 'Versi jurnal harus meningkat satu.' USING ERRCODE='23514'; END IF;
   IF OLD."postingStatus"='POSTED' AND "journal_edit_in_transaction"(OLD."id") THEN
     IF OLD."status"<>'POSTED' OR NEW."status"<>'POSTED' OR NEW."postingStatus"<>'POSTED'
       OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt" OR NEW."postedById" IS DISTINCT FROM OLD."postedById"
       OR NEW."reversedAt" IS DISTINCT FROM OLD."reversedAt" OR NEW."reversedById" IS DISTINCT FROM OLD."reversedById"
       OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason" THEN
       RAISE EXCEPTION 'Pengeditan tidak boleh mengubah status atau identitas posting.' USING ERRCODE='23514';
     END IF;
   ELSIF OLD."postingStatus"='POSTED' THEN
     IF OLD."status"<>'POSTED' OR NEW."status"<>'REVERSED' OR
       (to_jsonb(NEW)-ARRAY['status','reversedAt','reversedById','reversalReason','version','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','reversedAt','reversedById','reversalReason','version','updatedAt']) THEN
       RAISE EXCEPTION 'Pengeditan jurnal memerlukan audit yang sesuai.' USING ERRCODE='23514';
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
