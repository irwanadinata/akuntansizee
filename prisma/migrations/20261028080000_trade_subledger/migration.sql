-- Customer receivables and supplier payables; no seed or opening balances.
-- JournalSource values were committed in the preceding migration.
CREATE TYPE "TradeKind" AS ENUM ('RECEIVABLE', 'PAYABLE');

CREATE TABLE "TradeDocument" (
  "id" UUID NOT NULL,
  "kind" "TradeKind" NOT NULL,
  "documentNumber" VARCHAR(40) NOT NULL,
  "partyName" VARCHAR(200) NOT NULL,
  "date" DATE NOT NULL,
  "dueDate" DATE,
  "amount" DECIMAL(20,0) NOT NULL,
  "externalReference" VARCHAR(100),
  "notes" VARCHAR(1000),
  "counterAccountId" UUID NOT NULL,
  "controlAccountId" UUID NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "reversalEntryId" UUID,
  "reversalReason" VARCHAR(1000),
  "reversedAt" TIMESTAMPTZ(3),
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "TradeDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradeDocument_values_check" CHECK (
    "amount" > 0 AND LENGTH(BTRIM("partyName")) >= 1 AND "version" > 0
    AND "counterAccountId" <> "controlAccountId"
    AND ("dueDate" IS NULL OR "dueDate" >= "date")
    AND (("kind" = 'RECEIVABLE' AND "documentNumber" ~ '^PIU-[0-9]{8}-[A-Z0-9]{12}$')
      OR ("kind" = 'PAYABLE' AND "documentNumber" ~ '^UTG-[0-9]{8}-[A-Z0-9]{12}$'))
  ),
  CONSTRAINT "TradeDocument_reversal_check" CHECK (
    ("reversalEntryId" IS NULL AND "reversedAt" IS NULL AND "reversalReason" IS NULL)
    OR ("reversalEntryId" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL
      AND LENGTH(BTRIM("reversalReason")) >= 3 AND "reversalEntryId" <> "journalEntryId")
  )
);

CREATE TABLE "TradePayment" (
  "id" UUID NOT NULL,
  "paymentNumber" VARCHAR(40) NOT NULL,
  "documentId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "amount" DECIMAL(20,0) NOT NULL,
  "notes" VARCHAR(1000),
  "cashAccountId" UUID NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "reversalEntryId" UUID,
  "reversalReason" VARCHAR(1000),
  "reversedAt" TIMESTAMPTZ(3),
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "TradePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradePayment_values_check" CHECK (
    "amount" > 0 AND "version" > 0 AND "paymentNumber" ~ '^BY[CS]-[0-9]{8}-[A-Z0-9]{12}$'
  ),
  CONSTRAINT "TradePayment_reversal_check" CHECK (
    ("reversalEntryId" IS NULL AND "reversedAt" IS NULL AND "reversalReason" IS NULL)
    OR ("reversalEntryId" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL
      AND LENGTH(BTRIM("reversalReason")) >= 3 AND "reversalEntryId" <> "journalEntryId")
  )
);

CREATE TABLE "TradeRequest" (
  "id" UUID NOT NULL,
  "actorId" UUID NOT NULL,
  "operation" VARCHAR(32) NOT NULL,
  "requestKey" UUID NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradeRequest_hash_check" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX "TradeDocument_documentNumber_key" ON "TradeDocument"("documentNumber");
CREATE UNIQUE INDEX "TradeDocument_journalEntryId_key" ON "TradeDocument"("journalEntryId");
CREATE UNIQUE INDEX "TradeDocument_reversalEntryId_key" ON "TradeDocument"("reversalEntryId");
CREATE INDEX "TradeDocument_kind_date_createdAt_id_idx" ON "TradeDocument"("kind", "date", "createdAt", "id");
CREATE INDEX "TradeDocument_kind_partyName_idx" ON "TradeDocument"("kind", "partyName");
CREATE UNIQUE INDEX "TradePayment_paymentNumber_key" ON "TradePayment"("paymentNumber");
CREATE UNIQUE INDEX "TradePayment_journalEntryId_key" ON "TradePayment"("journalEntryId");
CREATE UNIQUE INDEX "TradePayment_reversalEntryId_key" ON "TradePayment"("reversalEntryId");
CREATE INDEX "TradePayment_documentId_date_createdAt_id_idx" ON "TradePayment"("documentId", "date", "createdAt", "id");
CREATE UNIQUE INDEX "TradeRequest_scope_key" ON "TradeRequest"("actorId", "operation", "requestKey");

ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_counterAccountId_fkey" FOREIGN KEY ("counterAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_controlAccountId_fkey" FOREIGN KEY ("controlAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradePayment" ADD CONSTRAINT "TradePayment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "TradeDocument"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradePayment" ADD CONSTRAINT "TradePayment_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradePayment" ADD CONSTRAINT "TradePayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradePayment" ADD CONSTRAINT "TradePayment_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradePayment" ADD CONSTRAINT "TradePayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "TradeRequest" ADD CONSTRAINT "TradeRequest_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE TRIGGER "TradeRequest_append_only" BEFORE UPDATE OR DELETE ON "TradeRequest" FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();

-- Preserve the existing manual and employee-loan state transitions.
ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_state_check", DROP CONSTRAINT "JournalEntry_source_check";
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_state_check" CHECK (
  ("status"='DRAFT' AND "postingStatus"='DRAFT' AND "postedAt" IS NULL AND "postedById" IS NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL) OR
  ("status"='POSTED' AND "postingStatus"='POSTED' AND "postedAt" IS NOT NULL AND "postedById" IS NOT NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL) OR
  ("status"='REVERSED' AND "postingStatus"='POSTED' AND "sourceType" IN ('MANUAL','LOAN','LOAN_PAYMENT','TRADE_DOCUMENT','TRADE_PAYMENT')
    AND "postedAt" IS NOT NULL AND "postedById" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL
    AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason"))>=3)
), ADD CONSTRAINT "JournalEntry_source_check" CHECK (
  ("sourceType" IN ('MANUAL','LOAN','LOAN_PAYMENT','TRADE_DOCUMENT','TRADE_PAYMENT') AND "reverseOfId" IS NULL) OR
  ("sourceType"='REVERSAL' AND "reverseOfId" IS NOT NULL AND "reverseOfId"<>"id" AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason"))>=3)
);

CREATE FUNCTION "trade_history_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "TradeDocument"%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Tagihan/pembayaran terposting tidak dapat dihapus; gunakan pembalik.' USING ERRCODE='23514';
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

-- Reversal metadata and its audit belong to the same journal/subledger event.
CREATE FUNCTION "check_trade_reversal"(original_id UUID, reversal_id UUID, reversal_time TIMESTAMPTZ, reason TEXT, entity_name TEXT, entity_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE original "JournalEntry"%ROWTYPE; reversing "JournalEntry"%ROWTYPE;
BEGIN
  IF reversal_id IS NULL THEN RETURN; END IF;
  SELECT * INTO original FROM "JournalEntry" WHERE "id"=original_id;
  SELECT * INTO reversing FROM "JournalEntry" WHERE "id"=reversal_id;
  IF original."id" IS NULL OR reversing."id" IS NULL
    OR original."status"<>'REVERSED' OR original."postingStatus"<>'POSTED'
    OR reversing."sourceType"<>'REVERSAL' OR reversing."status"<>'POSTED' OR reversing."postingStatus"<>'POSTED'
    OR reversing."reverseOfId" IS DISTINCT FROM original_id OR reversing."date"<original."date"
    OR original."reversedAt" IS DISTINCT FROM reversal_time
    OR original."reversalReason" IS DISTINCT FROM reason OR reversing."reversalReason" IS DISTINCT FROM reason
    OR original."reversedById" IS DISTINCT FROM reversing."createdById"
    OR reversing."postedById" IS DISTINCT FROM reversing."createdById" THEN
    RAISE EXCEPTION 'Identitas, pelaku, alasan atau waktu pembalik tidak cocok dengan subledger.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"=entity_name AND "entityId"=entity_id
      AND "action"='REVERSED' AND "actorId"=reversing."createdById")
    OR NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=original_id
      AND "action"='REVERSED' AND "actorId"=reversing."createdById")
    OR NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=reversal_id
      AND "action"='POSTED_REVERSAL' AND "actorId"=reversing."createdById") THEN
    RAISE EXCEPTION 'Audit pembalikan jurnal dan subledger wajib cocok pelakunya.' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION "check_trade_graph"(target UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE doc "TradeDocument"%ROWTYPE; pay "TradePayment"%ROWTYPE; minimum NUMERIC; net NUMERIC; is_receivable BOOLEAN;
BEGIN
  -- All payments for one document serialize through this same parent row lock.
  SELECT * INTO doc FROM "TradeDocument" WHERE "id"=target FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  is_receivable:=doc."kind"='RECEIVABLE';
  IF NOT EXISTS(SELECT 1 FROM "Account" a WHERE a."id"=doc."controlAccountId" AND a."isControlAccount" AND NOT a."isContra"
    AND ((is_receivable AND a."code"='1121.1' AND a."mainType"='ASSET' AND a."reportGroup"='RECEIVABLE' AND a."normalBalance"='DEBIT')
      OR (NOT is_receivable AND a."code"='2110.1' AND a."mainType"='LIABILITY' AND a."reportGroup"='CURRENT_LIABILITY' AND a."normalBalance"='CREDIT'))) THEN
    RAISE EXCEPTION 'Akun kontrol piutang/utang tidak sesuai jenis tagihan.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "Account" a WHERE a."id"=doc."counterAccountId" AND NOT a."isContra" AND NOT a."isControlAccount"
    AND ((is_receivable AND a."mainType"='REVENUE' AND a."normalBalance"='CREDIT')
      OR (NOT is_receivable AND a."normalBalance"='DEBIT' AND a."mainType" IN ('EXPENSE','COGS','ASSET')
        AND NOT (a."mainType"='ASSET' AND a."reportGroup"='CASH_BANK')))) THEN
    RAISE EXCEPTION 'Akun pendapatan atau lawan tagihan supplier tidak sah.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "JournalEntry" e WHERE e."id"=doc."journalEntryId" AND e."sourceType"='TRADE_DOCUMENT'
    AND e."postingStatus"='POSTED' AND e."date"=doc."date" AND e."createdById"=doc."createdById" AND e."postedById"=doc."createdById"
    AND e."status"=CASE WHEN doc."reversalEntryId" IS NULL THEN 'POSTED'::"JournalStatus" ELSE 'REVERSED'::"JournalStatus" END) THEN
    RAISE EXCEPTION 'Tanggal, status, sumber atau pelaku jurnal tagihan tidak cocok.' USING ERRCODE='23514';
  END IF;
  IF (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=doc."journalEntryId")<>2 OR
    (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=doc."journalEntryId" AND (
      (is_receivable AND (("accountId"=doc."controlAccountId" AND "debit"=doc."amount" AND "credit"=0)
        OR ("accountId"=doc."counterAccountId" AND "credit"=doc."amount" AND "debit"=0)))
      OR (NOT is_receivable AND (("accountId"=doc."counterAccountId" AND "debit"=doc."amount" AND "credit"=0)
        OR ("accountId"=doc."controlAccountId" AND "credit"=doc."amount" AND "debit"=0)))
    ))<>2 THEN
    RAISE EXCEPTION 'Dua baris debit/kredit tagihan tidak cocok nominal dan akunnya.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='TRADE_DOCUMENT' AND "entityId"=doc."id" AND "action"='CREATED' AND "actorId"=doc."createdById")
    OR NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=doc."journalEntryId" AND "action"='POSTED' AND "actorId"=doc."createdById") THEN
    RAISE EXCEPTION 'Audit tagihan dan posting jurnal wajib cocok pelakunya.' USING ERRCODE='23514';
  END IF;
  IF doc."reversalEntryId" IS NOT NULL THEN
    PERFORM "check_trade_reversal"(doc."journalEntryId",doc."reversalEntryId",doc."reversedAt",doc."reversalReason",'TRADE_DOCUMENT',doc."id");
    IF EXISTS(SELECT 1 FROM "TradePayment" WHERE "documentId"=doc."id" AND "reversalEntryId" IS NULL) THEN
      RAISE EXCEPTION 'Balik seluruh pembayaran aktif sebelum membatalkan tagihan.' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM "TradePayment" p
      LEFT JOIN "JournalEntry" r ON r."id"=p."reversalEntryId"
      JOIN "JournalEntry" dr ON dr."id"=doc."reversalEntryId"
      WHERE p."documentId"=doc."id" AND (p."date">dr."date" OR r."date">dr."date")) THEN
      RAISE EXCEPTION 'Pembatalan tagihan tidak boleh mendahului pembayaran atau pembaliknya.' USING ERRCODE='23514';
    END IF;
  END IF;

  FOR pay IN SELECT * FROM "TradePayment" WHERE "documentId"=doc."id" LOOP
    IF pay."date"<doc."date" OR pay."cashAccountId"=doc."controlAccountId"
      OR (is_receivable AND pay."paymentNumber" !~ '^BYC-[0-9]{8}-[A-Z0-9]{12}$')
      OR (NOT is_receivable AND pay."paymentNumber" !~ '^BYS-[0-9]{8}-[A-Z0-9]{12}$') THEN
      RAISE EXCEPTION 'Tanggal, jenis nomor atau akun pembayaran tidak cocok dengan tagihan.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "Account" a WHERE a."id"=pay."cashAccountId" AND a."mainType"='ASSET'
      AND a."reportGroup"='CASH_BANK' AND a."normalBalance"='DEBIT' AND NOT a."isContra" AND NOT a."isControlAccount") THEN
      RAISE EXCEPTION 'Akun kas/bank pembayaran tidak sah.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "JournalEntry" e WHERE e."id"=pay."journalEntryId" AND e."sourceType"='TRADE_PAYMENT'
      AND e."postingStatus"='POSTED' AND e."date"=pay."date" AND e."createdById"=pay."createdById" AND e."postedById"=pay."createdById"
      AND e."status"=CASE WHEN pay."reversalEntryId" IS NULL THEN 'POSTED'::"JournalStatus" ELSE 'REVERSED'::"JournalStatus" END) THEN
      RAISE EXCEPTION 'Tanggal, status, sumber atau pelaku jurnal pembayaran tidak cocok.' USING ERRCODE='23514';
    END IF;
    IF (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=pay."journalEntryId")<>2 OR
      (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=pay."journalEntryId" AND (
        (is_receivable AND (("accountId"=pay."cashAccountId" AND "debit"=pay."amount" AND "credit"=0)
          OR ("accountId"=doc."controlAccountId" AND "credit"=pay."amount" AND "debit"=0)))
        OR (NOT is_receivable AND (("accountId"=doc."controlAccountId" AND "debit"=pay."amount" AND "credit"=0)
          OR ("accountId"=pay."cashAccountId" AND "credit"=pay."amount" AND "debit"=0)))
      ))<>2 THEN
      RAISE EXCEPTION 'Dua baris debit/kredit pembayaran tidak cocok nominal dan akunnya.' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='TRADE_PAYMENT' AND "entityId"=pay."id" AND "action"='CREATED' AND "actorId"=pay."createdById")
      OR NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='JOURNAL' AND "entityId"=pay."journalEntryId" AND "action"='POSTED' AND "actorId"=pay."createdById") THEN
      RAISE EXCEPTION 'Audit pembayaran dan posting jurnal wajib cocok pelakunya.' USING ERRCODE='23514';
    END IF;
    IF pay."reversalEntryId" IS NOT NULL THEN
      PERFORM "check_trade_reversal"(pay."journalEntryId",pay."reversalEntryId",pay."reversedAt",pay."reversalReason",'TRADE_PAYMENT',pay."id");
    END IF;
  END LOOP;

  WITH ids AS (
    SELECT doc."journalEntryId" AS id
    UNION ALL SELECT doc."reversalEntryId" WHERE doc."reversalEntryId" IS NOT NULL
    UNION ALL SELECT "journalEntryId" FROM "TradePayment" WHERE "documentId"=doc."id"
    UNION ALL SELECT "reversalEntryId" FROM "TradePayment" WHERE "documentId"=doc."id" AND "reversalEntryId" IS NOT NULL
  ), movements AS (
    SELECT e."id",e."date",e."postedAt",
      SUM(CASE WHEN is_receivable THEN ln."debit"-ln."credit" ELSE ln."credit"-ln."debit" END) AS amount
    FROM ids JOIN "JournalEntry" e ON e."id"=ids.id JOIN "JournalLine" ln ON ln."entryId"=e."id"
    WHERE ln."accountId"=doc."controlAccountId" AND e."postingStatus"='POSTED'
    GROUP BY e."id",e."date",e."postedAt"
  ), running AS (
    SELECT amount,SUM(amount) OVER(ORDER BY "date","postedAt","id") AS balance FROM movements
  )
  SELECT COALESCE(MIN(balance),0),COALESCE(SUM(amount),0) INTO minimum,net FROM running;
  IF minimum<0 OR net<0 OR (doc."reversalEntryId" IS NOT NULL AND net<>0) THEN
    RAISE EXCEPTION 'Sisa tagihan historis negatif atau pembatalan tagihan tidak nol.' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION "trade_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; entry UUID; parent "JournalEntry"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='TradeDocument' THEN target:=NEW."id";
  ELSIF TG_TABLE_NAME='TradePayment' THEN target:=NEW."documentId";
  ELSE
    IF TG_TABLE_NAME='JournalLine' THEN entry:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
    ELSE entry:=CASE WHEN TG_OP='DELETE' THEN OLD."id" ELSE NEW."id" END; END IF;
    SELECT * INTO parent FROM "JournalEntry" WHERE "id"=entry;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT d."id" INTO target FROM "TradeDocument" d WHERE d."journalEntryId"=entry OR d."reversalEntryId"=entry;
    IF target IS NULL THEN
      SELECT p."documentId" INTO target FROM "TradePayment" p WHERE p."journalEntryId"=entry OR p."reversalEntryId"=entry;
    END IF;
    IF target IS NULL AND (parent."sourceType" IN ('TRADE_DOCUMENT','TRADE_PAYMENT') OR
      (parent."sourceType"='REVERSAL' AND EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=parent."reverseOfId" AND "sourceType" IN ('TRADE_DOCUMENT','TRADE_PAYMENT')))) THEN
      RAISE EXCEPTION 'Jurnal piutang/utang otomatis dan pembalik wajib tertaut ke subledger.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF target IS NOT NULL THEN PERFORM "check_trade_graph"(target); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "TradeDocument_final_check" AFTER INSERT OR UPDATE ON "TradeDocument" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "trade_final_check"();
CREATE CONSTRAINT TRIGGER "TradePayment_final_check" AFTER INSERT OR UPDATE ON "TradePayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "trade_final_check"();
CREATE CONSTRAINT TRIGGER "JournalEntry_trade_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "trade_final_check"();
CREATE CONSTRAINT TRIGGER "JournalLine_trade_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "trade_final_check"();
CREATE TRIGGER "TradeDocument_history_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TradeDocument" FOR EACH ROW EXECUTE FUNCTION "trade_history_guard"();
CREATE TRIGGER "TradePayment_history_guard" BEFORE INSERT OR UPDATE OR DELETE ON "TradePayment" FOR EACH ROW EXECUTE FUNCTION "trade_history_guard"();

CREATE OR REPLACE FUNCTION "journal_line_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "JournalEntry"%ROWTYPE; acc "Account"%ROWTYPE; fiscal "FiscalYear"%ROWTYPE; target UUID; authorized BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND (NEW."entryId"<>OLD."entryId" OR NEW."id"<>OLD."id") THEN
    RAISE EXCEPTION 'Identitas baris jurnal tetap.' USING ERRCODE='23514';
  END IF;
  target:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
  SELECT * INTO parent FROM "JournalEntry" WHERE "id"=target FOR UPDATE;
  IF NOT FOUND AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF parent."postingStatus"='POSTED' THEN RAISE EXCEPTION 'Baris jurnal terposting immutable.' USING ERRCODE='23514'; END IF;
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

-- Existing balance/marker/audit/reversal invariants are unchanged; only the set
-- of original sources eligible for reversal is extended to the trade sources.
CREATE OR REPLACE FUNCTION "journal_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    IF e."postingStatus"<>'POSTED' OR origin."status"<>'REVERSED'
      OR origin."sourceType" NOT IN ('MANUAL','LOAN','LOAN_PAYMENT','TRADE_DOCUMENT','TRADE_PAYMENT') OR e."date"<origin."date" THEN
      RAISE EXCEPTION 'Pasangan pembalikan/tanggal tidak sah.' USING ERRCODE='23514';
    END IF;
    IF n<>(SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=origin."id") OR EXISTS (
      SELECT 1 FROM "JournalLine" l LEFT JOIN "JournalLine" o ON o."entryId"=origin."id" AND o."lineNo"=l."lineNo"
      WHERE l."entryId"=e."id" AND (o."id" IS NULL OR o."accountId"<>l."accountId" OR o."debit"<>l."credit" OR o."credit"<>l."debit")
    ) THEN RAISE EXCEPTION 'Pembalik harus menukar seluruh debit dan kredit jurnal asal.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
