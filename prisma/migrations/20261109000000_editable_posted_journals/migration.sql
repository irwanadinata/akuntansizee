-- Manual journal numbers and audited, atomic edits. Existing data is not posted or rewritten.
ALTER TABLE "JournalNumber" DROP CONSTRAINT "JournalNumber_format_check";
ALTER TABLE "JournalNumber" ADD CONSTRAINT "JournalNumber_format_check"
 CHECK ("journalNumber" ~ '^[A-Z0-9][A-Z0-9./_-]{0,39}$');

CREATE FUNCTION "journal_snapshot"(target UUID) RETURNS JSONB LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('journalNumber',e."journalNumber",'date',to_char(e."date",'YYYY-MM-DD'),
   'description',e."description",'version',e."version",'lines',
   (SELECT COALESCE(jsonb_agg(jsonb_build_object('accountId',l."accountId",'debit',l."debit"::text,
     'credit',l."credit"::text,'description',COALESCE(l."description",'')) ORDER BY l."lineNo"),'[]'::jsonb)
    FROM "JournalLine" l WHERE l."entryId"=e."id"))
 FROM "JournalEntry" e WHERE e."id"=target
$$;

CREATE FUNCTION "journal_edit_in_transaction"(target UUID) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "AuditEvent" a JOIN "JournalEntry" e ON e."id"=a."entityId"
 WHERE a."entity"='JOURNAL' AND a."entityId"=target AND a."action"='EDITED'
 AND a."details"->>'transactionId'=txid_current()::text
 AND ((a."details"->>'fromVersion')::int=e."version" OR (a."details"->>'toVersion')::int=e."version"))
$$;

CREATE FUNCTION "journal_edit_audit_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE e "JournalEntry"%ROWTYPE;
BEGIN
 IF NEW."entity"<>'JOURNAL' OR NEW."action"<>'EDITED' THEN RETURN NEW; END IF;
 SELECT * INTO e FROM "JournalEntry" WHERE "id"=NEW."entityId" FOR UPDATE;
 IF NOT FOUND OR e."status"='REVERSED' OR e."sourceType"='REVERSAL' THEN
   RAISE EXCEPTION 'Riwayat jurnal yang sudah dibatalkan tidak dapat diedit.' USING ERRCODE='23514';
 END IF;
 IF NEW."details"->>'transactionId' IS DISTINCT FROM txid_current()::text
 OR NEW."details"->'before' IS DISTINCT FROM "journal_snapshot"(e."id")
 OR NEW."details"->>'fromVersion' IS DISTINCT FROM e."version"::text
 OR NEW."details"->>'toVersion' IS DISTINCT FROM (e."version"+1)::text
 OR NEW."details"->'after'->>'version' IS DISTINCT FROM (e."version"+1)::text
 OR LENGTH(BTRIM(COALESCE(NEW."details"->>'reason','')))<3
 OR "journal_edit_in_transaction"(e."id") THEN
   RAISE EXCEPTION 'Audit perubahan wajib sesuai jurnal asal, versi, alasan dan transaksi saat ini.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AuditEvent_journal_edit_guard" BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION "journal_edit_audit_guard"();

CREATE OR REPLACE FUNCTION "journal_header_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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

CREATE OR REPLACE FUNCTION "journal_line_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "JournalEntry"%ROWTYPE; acc "Account"%ROWTYPE; fiscal "FiscalYear"%ROWTYPE; target UUID; authorized BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND (NEW."entryId"<>OLD."entryId" OR NEW."id"<>OLD."id") THEN
    RAISE EXCEPTION 'Identitas baris jurnal tetap.' USING ERRCODE='23514';
  END IF;
  target:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
  SELECT * INTO parent FROM "JournalEntry" WHERE "id"=target FOR UPDATE;
  IF NOT FOUND AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF parent."postingStatus"='POSTED' AND NOT "journal_edit_in_transaction"(parent."id") THEN RAISE EXCEPTION 'Perubahan baris jurnal memerlukan audit yang sesuai.' USING ERRCODE='23514'; END IF;
  SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=parent."fiscalYearId" FOR SHARE;
  IF fiscal."status"<>'OPEN' THEN RAISE EXCEPTION 'Periode terkunci.' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO acc FROM "Account" WHERE "id"=NEW."accountId" FOR UPDATE;
  IF acc."isControlAccount" THEN
    SELECT
      (acc."code"='1122.1' AND (
        (parent."sourceType"='LOAN' AND EXISTS(SELECT 1 FROM "Loan" l WHERE l."journalEntryId"=parent."id" AND l."controlAccountId"=acc."id")) OR
        (parent."sourceType"='LOAN_PAYMENT' AND EXISTS(SELECT 1 FROM "LoanPayment" p JOIN "Loan" l ON l."id"=p."loanId" WHERE p."journalEntryId"=parent."id" AND l."controlAccountId"=acc."id")) OR
        (parent."sourceType"='REVERSAL' AND (
          EXISTS(SELECT 1 FROM "Loan" l WHERE l."journalEntryId"=parent."reverseOfId" AND l."controlAccountId"=acc."id") OR
          EXISTS(SELECT 1 FROM "LoanPayment" p JOIN "Loan" l ON l."id"=p."loanId" WHERE p."journalEntryId"=parent."reverseOfId" AND l."controlAccountId"=acc."id")
        ))
      )) OR
      (acc."code" IN ('1121.1','2110.1') AND (
        (parent."sourceType"='TRADE_DOCUMENT' AND EXISTS(
          SELECT 1 FROM "TradeDocument" d WHERE d."journalEntryId"=parent."id" AND d."controlAccountId"=acc."id"
            AND ((d."kind"='RECEIVABLE' AND acc."code"='1121.1') OR (d."kind"='PAYABLE' AND acc."code"='2110.1'))
        )) OR
        (parent."sourceType"='TRADE_PAYMENT' AND EXISTS(
          SELECT 1 FROM "TradePayment" p JOIN "TradeDocument" d ON d."id"=p."documentId"
          WHERE p."journalEntryId"=parent."id" AND d."controlAccountId"=acc."id"
            AND ((d."kind"='RECEIVABLE' AND acc."code"='1121.1') OR (d."kind"='PAYABLE' AND acc."code"='2110.1'))
        )) OR
        (parent."sourceType"='REVERSAL' AND (
          EXISTS(SELECT 1 FROM "TradeDocument" d WHERE d."journalEntryId"=parent."reverseOfId" AND d."controlAccountId"=acc."id"
            AND ((d."kind"='RECEIVABLE' AND acc."code"='1121.1') OR (d."kind"='PAYABLE' AND acc."code"='2110.1'))) OR
          EXISTS(SELECT 1 FROM "TradePayment" p JOIN "TradeDocument" d ON d."id"=p."documentId"
            WHERE p."journalEntryId"=parent."reverseOfId" AND d."controlAccountId"=acc."id"
              AND ((d."kind"='RECEIVABLE' AND acc."code"='1121.1') OR (d."kind"='PAYABLE' AND acc."code"='2110.1')))
        ))
      )) INTO authorized;
    IF NOT COALESCE(authorized,FALSE) THEN
      RAISE EXCEPTION 'Akun kontrol wajib memiliki subledger yang sesuai; jurnal manual diblokir.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF parent."sourceType"<>'REVERSAL' AND (NOT acc."isActive" OR (acc."requiresReview" AND acc."reviewedAt" IS NULL)) THEN
    RAISE EXCEPTION 'Akun nonaktif/belum direview.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "loan_history_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "Loan"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD."reversalEntryId" IS NULL AND NEW."version"=OLD."version"+1
   AND "journal_edit_in_transaction"(OLD."journalEntryId") THEN
   IF TG_TABLE_NAME='Loan' AND
     (to_jsonb(NEW)-ARRAY['employeeName','date','dueDate','amount','notes','cashAccountId','version','updatedAt']) IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['employeeName','date','dueDate','amount','notes','cashAccountId','version','updatedAt']) THEN RETURN NEW; END IF;
   IF TG_TABLE_NAME='LoanPayment' AND
     (to_jsonb(NEW)-ARRAY['date','amount','notes','cashAccountId','version','updatedAt']) IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['date','amount','notes','cashAccountId','version','updatedAt']) THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Identitas transaksi, akun kontrol dan hubungan jurnal tetap.' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Pinjaman/cicilan terposting tidak dapat dihapus; gunakan pengeditan dengan audit.' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='LoanPayment' THEN
   SELECT * INTO parent FROM "Loan" WHERE "id"=NEW."loanId" FOR UPDATE;
   IF NOT FOUND OR parent."reversalEntryId" IS NOT NULL THEN RAISE EXCEPTION 'Pinjaman tidak tersedia atau sudah dibatalkan.' USING ERRCODE='23514'; END IF;
   IF NEW."date"<parent."date" THEN RAISE EXCEPTION 'Cicilan mendahului pinjaman.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD."reversalEntryId" IS NOT NULL OR NEW."version"<>OLD."version"+1 OR
      (to_jsonb(NEW)-ARRAY['version','updatedAt','reversalEntryId','reversedAt','reversalReason']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['version','updatedAt','reversalEntryId','reversedAt','reversalReason']) THEN
     RAISE EXCEPTION 'Identitas dan nominal pinjaman/cicilan immutable.' USING ERRCODE='23514';
   END IF;
   IF TG_TABLE_NAME='LoanPayment' AND NEW."reversalEntryId" IS NULL THEN RAISE EXCEPTION 'Perubahan cicilan wajib disimpan bersama jurnal dan audit.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "trade_history_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "TradeDocument"%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND OLD."reversalEntryId" IS NULL AND NEW."version"=OLD."version"+1
   AND "journal_edit_in_transaction"(OLD."journalEntryId") THEN
   IF TG_TABLE_NAME='TradeDocument' AND
     (to_jsonb(NEW)-ARRAY['partyName','date','dueDate','amount','notes','externalReference','counterAccountId','version','updatedAt']) IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['partyName','date','dueDate','amount','notes','externalReference','counterAccountId','version','updatedAt']) THEN RETURN NEW; END IF;
   IF TG_TABLE_NAME='TradePayment' AND
     (to_jsonb(NEW)-ARRAY['date','amount','notes','cashAccountId','version','updatedAt']) IS NOT DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['date','amount','notes','cashAccountId','version','updatedAt']) THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Identitas transaksi, akun kontrol dan hubungan jurnal tetap.' USING ERRCODE='23514';
 END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Tagihan/pembayaran terposting tidak dapat dihapus; gunakan pengeditan dengan audit.' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='TradePayment' THEN
    SELECT * INTO parent FROM "TradeDocument" WHERE "id"=NEW."documentId" FOR UPDATE;
    IF NOT FOUND OR parent."reversalEntryId" IS NOT NULL THEN
      RAISE EXCEPTION 'Tagihan tidak tersedia atau sudah dibatalkan.' USING ERRCODE='23514';
    END IF;
    IF NEW."date"<parent."date" OR NEW."cashAccountId"=parent."controlAccountId" THEN
      RAISE EXCEPTION 'Tanggal atau akun pembayaran tidak sah.' USING ERRCODE='23514';
    END IF;
    IF (parent."kind"='RECEIVABLE' AND NEW."paymentNumber" !~ '^BYC-[0-9]{8}-[A-Z0-9]{12}$')
      OR (parent."kind"='PAYABLE' AND NEW."paymentNumber" !~ '^BYS-[0-9]{8}-[A-Z0-9]{12}$') THEN
      RAISE EXCEPTION 'Jenis nomor pembayaran tidak sesuai tagihan.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW."version"<>1 OR NEW."reversalEntryId" IS NOT NULL THEN
      RAISE EXCEPTION 'Tagihan/pembayaran baru harus dibuat tanpa pembalik dan pada versi awal.' USING ERRCODE='23514';
    END IF;
  ELSIF OLD."reversalEntryId" IS NOT NULL
    OR (TG_TABLE_NAME='TradePayment' AND NEW."reversalEntryId" IS NULL)
    OR NEW."version"<>OLD."version"+1 OR
    (to_jsonb(NEW)-ARRAY['version','updatedAt','reversalEntryId','reversedAt','reversalReason']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['version','updatedAt','reversalEntryId','reversedAt','reversalReason']) THEN
    RAISE EXCEPTION 'Identitas, pihak, tanggal dan nominal tagihan/pembayaran immutable.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION "journal_cutover_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cutover DATE;
BEGIN
  IF NEW."postingStatus"<>'POSTED' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('zee:opening-cutover',0));
  SELECT "cutoverDate" INTO cutover FROM "OpeningJournal" WHERE "singletonKey"=1;
  IF cutover IS NOT NULL AND NEW."date"<cutover THEN
    RAISE EXCEPTION 'Posting sebelum tanggal cutover saldo pembukaan ditolak.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION "journal_edit_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; expected JSONB;
BEGIN
 IF TG_TABLE_NAME='AuditEvent' THEN
   IF NEW."entity"<>'JOURNAL' OR NEW."action"<>'EDITED' THEN RETURN NULL; END IF;
   target:=NEW."entityId";
 ELSIF TG_TABLE_NAME='JournalLine' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
 ELSE target:=NEW."id"; END IF;
 SELECT a."details"->'after' INTO expected FROM "AuditEvent" a
 WHERE a."entity"='JOURNAL' AND a."entityId"=target AND a."action"='EDITED'
 AND a."details"->>'transactionId'=txid_current()::text;
 IF FOUND AND (expected IS DISTINCT FROM "journal_snapshot"(target)
   OR NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=target AND "status"='POSTED' AND "postingStatus"='POSTED')) THEN
   RAISE EXCEPTION 'Jurnal akhir wajib sesuai perubahan yang disimpan pada audit.' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "AuditEvent_journal_edit_check" AFTER INSERT ON "AuditEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_edit_final_check"();
CREATE CONSTRAINT TRIGGER "JournalEntry_edit_check" AFTER INSERT OR UPDATE ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_edit_final_check"();
CREATE CONSTRAINT TRIGGER "JournalLine_edit_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "journal_edit_final_check"();
