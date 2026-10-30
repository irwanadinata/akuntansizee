-- Employee loan subledger only; no account, employee master, balance or transaction seed.
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "loanNumber" VARCHAR(40) NOT NULL,
    "employeeName" VARCHAR(200) NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "amount" DECIMAL(20,0) NOT NULL,
    "notes" VARCHAR(1000),
    "cashAccountId" UUID NOT NULL,
    "controlAccountId" UUID NOT NULL,
    "journalEntryId" UUID NOT NULL,
    "reversalEntryId" UUID,
    "reversalReason" VARCHAR(1000),
    "reversedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoanPayment" (
    "id" UUID NOT NULL,
    "paymentNumber" VARCHAR(40) NOT NULL,
    "loanId" UUID NOT NULL,
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

    CONSTRAINT "LoanPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoanRequest" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "operation" VARCHAR(32) NOT NULL,
    "requestKey" UUID NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Loan_loanNumber_key" ON "Loan"("loanNumber");

CREATE UNIQUE INDEX "Loan_journalEntryId_key" ON "Loan"("journalEntryId");

CREATE UNIQUE INDEX "Loan_reversalEntryId_key" ON "Loan"("reversalEntryId");

CREATE INDEX "Loan_date_createdAt_id_idx" ON "Loan"("date", "createdAt", "id");

CREATE INDEX "Loan_employeeName_idx" ON "Loan"("employeeName");

CREATE UNIQUE INDEX "LoanPayment_paymentNumber_key" ON "LoanPayment"("paymentNumber");

CREATE UNIQUE INDEX "LoanPayment_journalEntryId_key" ON "LoanPayment"("journalEntryId");

CREATE UNIQUE INDEX "LoanPayment_reversalEntryId_key" ON "LoanPayment"("reversalEntryId");

CREATE INDEX "LoanPayment_loanId_date_createdAt_id_idx" ON "LoanPayment"("loanId", "date", "createdAt", "id");

CREATE UNIQUE INDEX "LoanRequest_scope_key" ON "LoanRequest"("actorId", "operation", "requestKey");

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_controlAccountId_fkey" FOREIGN KEY ("controlAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Loan" ADD CONSTRAINT "Loan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
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
   IF e."postingStatus"<>'POSTED' OR origin."status"<>'REVERSED' OR origin."sourceType" NOT IN ('MANUAL','LOAN','LOAN_PAYMENT') OR e."date"<origin."date" THEN
     RAISE EXCEPTION 'Pasangan pembalikan/tanggal tidak sah.' USING ERRCODE='23514';
   END IF;
   IF n<>(SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=origin."id") OR EXISTS (
     SELECT 1 FROM "JournalLine" l LEFT JOIN "JournalLine" o ON o."entryId"=origin."id" AND o."lineNo"=l."lineNo"
     WHERE l."entryId"=e."id" AND (o."id" IS NULL OR o."accountId"<>l."accountId" OR o."debit"<>l."credit" OR o."credit"<>l."debit")
   ) THEN RAISE EXCEPTION 'Pembalik harus menukar seluruh debit dan kredit jurnal asal.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

ALTER TABLE "JournalEntry" DROP CONSTRAINT "JournalEntry_state_check", DROP CONSTRAINT "JournalEntry_source_check";
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_state_check" CHECK (
 ("status"='DRAFT' AND "postingStatus"='DRAFT' AND "postedAt" IS NULL AND "postedById" IS NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL) OR
 ("status"='POSTED' AND "postingStatus"='POSTED' AND "postedAt" IS NOT NULL AND "postedById" IS NOT NULL AND "reversedAt" IS NULL AND "reversedById" IS NULL) OR
 ("status"='REVERSED' AND "postingStatus"='POSTED' AND "sourceType" IN ('MANUAL','LOAN','LOAN_PAYMENT') AND "postedAt" IS NOT NULL AND "postedById" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason"))>=3)
), ADD CONSTRAINT "JournalEntry_source_check" CHECK (
 ("sourceType" IN ('MANUAL','LOAN','LOAN_PAYMENT') AND "reverseOfId" IS NULL) OR
 ("sourceType"='REVERSAL' AND "reverseOfId" IS NOT NULL AND "reverseOfId"<>"id" AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason"))>=3)
);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_values_check" CHECK ("amount">0 AND LENGTH(BTRIM("employeeName"))>=2 AND "version">0 AND "cashAccountId"<>"controlAccountId" AND ("dueDate" IS NULL OR "dueDate">="date") AND "loanNumber" ~ '^PJM-[0-9]{8}-[A-Z0-9]{12}$'),
 ADD CONSTRAINT "Loan_reversal_check" CHECK (("reversalEntryId" IS NULL AND "reversedAt" IS NULL AND "reversalReason" IS NULL) OR ("reversalEntryId" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason"))>=3));
ALTER TABLE "LoanPayment" ADD CONSTRAINT "LoanPayment_values_check" CHECK ("amount">0 AND "version">0 AND "paymentNumber" ~ '^CIC-[0-9]{8}-[A-Z0-9]{12}$'),
 ADD CONSTRAINT "LoanPayment_reversal_check" CHECK (("reversalEntryId" IS NULL AND "reversedAt" IS NULL AND "reversalReason" IS NULL) OR ("reversalEntryId" IS NOT NULL AND "reversedAt" IS NOT NULL AND "reversalReason" IS NOT NULL AND LENGTH(BTRIM("reversalReason"))>=3));
ALTER TABLE "LoanRequest" ADD CONSTRAINT "LoanRequest_hash_check" CHECK ("payloadHash" ~ '^[a-f0-9]{64}$');
CREATE TRIGGER "LoanRequest_append_only" BEFORE UPDATE OR DELETE ON "LoanRequest" FOR EACH ROW EXECUTE FUNCTION "coa_append_only"();

CREATE FUNCTION "loan_history_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "Loan"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Pinjaman/cicilan terposting tidak dapat dihapus; gunakan pembalik.' USING ERRCODE='23514'; END IF;
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
   IF TG_TABLE_NAME='LoanPayment' AND NEW."reversalEntryId" IS NULL THEN RAISE EXCEPTION 'Cicilan hanya dapat dibatalkan dengan pembalik.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "Loan_history_guard" BEFORE UPDATE OR DELETE ON "Loan" FOR EACH ROW EXECUTE FUNCTION "loan_history_guard"();
CREATE TRIGGER "LoanPayment_history_guard" BEFORE INSERT OR UPDATE OR DELETE ON "LoanPayment" FOR EACH ROW EXECUTE FUNCTION "loan_history_guard"();

CREATE OR REPLACE FUNCTION "journal_line_guard"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent "JournalEntry"%ROWTYPE; acc "Account"%ROWTYPE; fiscal "FiscalYear"%ROWTYPE; target UUID; authorized BOOLEAN;
BEGIN
 IF TG_OP='UPDATE' AND (NEW."entryId"<>OLD."entryId" OR NEW."id"<>OLD."id") THEN RAISE EXCEPTION 'Identitas baris jurnal tetap.' USING ERRCODE='23514'; END IF;
 target:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
 SELECT * INTO parent FROM "JournalEntry" WHERE "id"=target FOR UPDATE;
 IF NOT FOUND AND TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF parent."postingStatus"='POSTED' THEN RAISE EXCEPTION 'Baris jurnal terposting immutable.' USING ERRCODE='23514'; END IF;
 SELECT * INTO fiscal FROM "FiscalYear" WHERE "id"=parent."fiscalYearId" FOR SHARE;
 IF fiscal."status"<>'OPEN' THEN RAISE EXCEPTION 'Periode terkunci.' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT * INTO acc FROM "Account" WHERE "id"=NEW."accountId" FOR UPDATE;
 IF acc."isControlAccount" THEN
   SELECT acc."code"='1122.1' AND (
     (parent."sourceType"='LOAN' AND EXISTS(SELECT 1 FROM "Loan" l WHERE l."journalEntryId"=parent."id" AND l."controlAccountId"=acc."id")) OR
     (parent."sourceType"='LOAN_PAYMENT' AND EXISTS(SELECT 1 FROM "LoanPayment" p JOIN "Loan" l ON l."id"=p."loanId" WHERE p."journalEntryId"=parent."id" AND l."controlAccountId"=acc."id")) OR
     (parent."sourceType"='REVERSAL' AND (
       EXISTS(SELECT 1 FROM "Loan" l WHERE l."journalEntryId"=parent."reverseOfId" AND l."controlAccountId"=acc."id") OR
       EXISTS(SELECT 1 FROM "LoanPayment" p JOIN "Loan" l ON l."id"=p."loanId" WHERE p."journalEntryId"=parent."reverseOfId" AND l."controlAccountId"=acc."id")
     ))
   ) INTO authorized;
   IF NOT COALESCE(authorized,FALSE) THEN RAISE EXCEPTION 'Akun kontrol wajib memiliki subledger yang sesuai; jurnal manual diblokir.' USING ERRCODE='23514'; END IF;
 END IF;
 IF parent."sourceType"<>'REVERSAL' AND (NOT acc."isActive" OR (acc."requiresReview" AND acc."reviewedAt" IS NULL)) THEN RAISE EXCEPTION 'Akun nonaktif/belum direview.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION "check_loan_graph"(target UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE l "Loan"%ROWTYPE; p "LoanPayment"%ROWTYPE; minimum NUMERIC; net NUMERIC;
BEGIN
 SELECT * INTO l FROM "Loan" WHERE "id"=target FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "id"=l."controlAccountId" AND "code"='1122.1' AND "isControlAccount" AND NOT "isContra" AND "mainType"='ASSET' AND "reportGroup"='RECEIVABLE' AND "normalBalance"='DEBIT') THEN RAISE EXCEPTION 'Akun kontrol pinjaman tidak sah.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "id"=l."cashAccountId" AND "mainType"='ASSET' AND "reportGroup"='CASH_BANK' AND "normalBalance"='DEBIT' AND NOT "isContra" AND NOT "isControlAccount") THEN RAISE EXCEPTION 'Kas/bank pinjaman tidak sah.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=l."journalEntryId" AND "sourceType"='LOAN' AND "postingStatus"='POSTED' AND "date"=l."date" AND "createdById"=l."createdById" AND "status"=CASE WHEN l."reversalEntryId" IS NULL THEN 'POSTED'::"JournalStatus" ELSE 'REVERSED'::"JournalStatus" END) THEN RAISE EXCEPTION 'Jurnal pinjaman dan subledger tidak cocok.' USING ERRCODE='23514'; END IF;
 IF (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=l."journalEntryId")<>2 OR
    (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=l."journalEntryId" AND (("accountId"=l."controlAccountId" AND "debit"=l."amount" AND "credit"=0) OR ("accountId"=l."cashAccountId" AND "credit"=l."amount" AND "debit"=0)))<>2 THEN
   RAISE EXCEPTION 'Debit/kredit pinjaman tidak cocok nominal/subledger.' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='LOAN' AND "entityId"=l."id" AND "action"='CREATED') THEN RAISE EXCEPTION 'Audit pinjaman wajib ada.' USING ERRCODE='23514'; END IF;
 IF l."reversalEntryId" IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=l."reversalEntryId" AND "reverseOfId"=l."journalEntryId" AND "postingStatus"='POSTED' AND "sourceType"='REVERSAL') OR
      EXISTS(SELECT 1 FROM "LoanPayment" WHERE "loanId"=l."id" AND "reversalEntryId" IS NULL) THEN RAISE EXCEPTION 'Batalkan semua cicilan sebelum membatalkan pinjaman.' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM "LoanPayment" pay LEFT JOIN "JournalEntry" r ON r."id"=pay."reversalEntryId" JOIN "JournalEntry" lr ON lr."id"=l."reversalEntryId"
       WHERE pay."loanId"=l."id" AND (pay."date">lr."date" OR r."date">lr."date")) THEN RAISE EXCEPTION 'Tanggal pembatalan pinjaman mendahului cicilan/pembalik.' USING ERRCODE='23514'; END IF;
 END IF;
 FOR p IN SELECT * FROM "LoanPayment" WHERE "loanId"=l."id" LOOP
   IF p."date"<l."date" OR NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=p."journalEntryId" AND "sourceType"='LOAN_PAYMENT' AND "postingStatus"='POSTED' AND "date"=p."date" AND "createdById"=p."createdById" AND "status"=CASE WHEN p."reversalEntryId" IS NULL THEN 'POSTED'::"JournalStatus" ELSE 'REVERSED'::"JournalStatus" END) THEN RAISE EXCEPTION 'Jurnal cicilan dan subledger tidak cocok.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM "Account" WHERE "id"=p."cashAccountId" AND "mainType"='ASSET' AND "reportGroup"='CASH_BANK' AND "normalBalance"='DEBIT' AND NOT "isContra" AND NOT "isControlAccount") THEN RAISE EXCEPTION 'Kas/bank cicilan tidak sah.' USING ERRCODE='23514'; END IF;
   IF (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=p."journalEntryId")<>2 OR
      (SELECT COUNT(*) FROM "JournalLine" WHERE "entryId"=p."journalEntryId" AND (("accountId"=p."cashAccountId" AND "debit"=p."amount" AND "credit"=0) OR ("accountId"=l."controlAccountId" AND "credit"=p."amount" AND "debit"=0)))<>2 THEN RAISE EXCEPTION 'Debit/kredit cicilan tidak cocok nominal/subledger.' USING ERRCODE='23514'; END IF;
   IF p."reversalEntryId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=p."reversalEntryId" AND "reverseOfId"=p."journalEntryId" AND "postingStatus"='POSTED' AND "sourceType"='REVERSAL') THEN RAISE EXCEPTION 'Pembalik cicilan tidak tertaut.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM "AuditEvent" WHERE "entity"='LOAN_PAYMENT' AND "entityId"=p."id" AND "action"='CREATED') THEN RAISE EXCEPTION 'Audit cicilan wajib ada.' USING ERRCODE='23514'; END IF;
 END LOOP;
 WITH ids AS (
   SELECT l."journalEntryId" AS id UNION ALL SELECT l."reversalEntryId" WHERE l."reversalEntryId" IS NOT NULL
   UNION ALL SELECT "journalEntryId" FROM "LoanPayment" WHERE "loanId"=l."id"
   UNION ALL SELECT "reversalEntryId" FROM "LoanPayment" WHERE "loanId"=l."id" AND "reversalEntryId" IS NOT NULL
 ), movements AS (
   SELECT e."id",e."date",e."postedAt",SUM(ln."debit"-ln."credit") AS amount FROM ids
   JOIN "JournalEntry" e ON e."id"=ids.id JOIN "JournalLine" ln ON ln."entryId"=e."id"
   WHERE ln."accountId"=l."controlAccountId" AND e."postingStatus"='POSTED' GROUP BY e."id",e."date",e."postedAt"
 ), running AS (SELECT amount, SUM(amount) OVER(ORDER BY "date","postedAt","id") AS balance FROM movements)
 SELECT COALESCE(MIN(balance),0),COALESCE(SUM(amount),0) INTO minimum,net FROM running;
 IF minimum<0 OR net<0 OR (l."reversalEntryId" IS NOT NULL AND net<>0) THEN RAISE EXCEPTION 'Sisa pinjaman historis negatif atau pembatalan tidak nol.' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION "loan_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; entry UUID; parent "JournalEntry"%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='Loan' THEN target:=NEW."id";
 ELSIF TG_TABLE_NAME='LoanPayment' THEN target:=NEW."loanId";
 ELSE
   IF TG_TABLE_NAME='JournalLine' THEN entry:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
   ELSE entry:=CASE WHEN TG_OP='DELETE' THEN OLD."id" ELSE NEW."id" END; END IF;
   SELECT * INTO parent FROM "JournalEntry" WHERE "id"=entry;
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT l."id" INTO target FROM "Loan" l WHERE l."journalEntryId"=entry OR l."reversalEntryId"=entry;
   IF target IS NULL THEN SELECT p."loanId" INTO target FROM "LoanPayment" p WHERE p."journalEntryId"=entry OR p."reversalEntryId"=entry; END IF;
   IF target IS NULL AND (parent."sourceType" IN ('LOAN','LOAN_PAYMENT') OR (parent."sourceType"='REVERSAL' AND EXISTS(SELECT 1 FROM "JournalEntry" WHERE "id"=parent."reverseOfId" AND "sourceType" IN ('LOAN','LOAN_PAYMENT')))) THEN
     RAISE EXCEPTION 'Jurnal otomatis wajib tertaut ke subledger/pembaliknya.' USING ERRCODE='23514';
   END IF;
 END IF;
 IF target IS NOT NULL THEN PERFORM "check_loan_graph"(target); END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "Loan_final_check" AFTER INSERT OR UPDATE ON "Loan" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "loan_final_check"();
CREATE CONSTRAINT TRIGGER "LoanPayment_final_check" AFTER INSERT OR UPDATE ON "LoanPayment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "loan_final_check"();
CREATE CONSTRAINT TRIGGER "JournalEntry_loan_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "loan_final_check"();
CREATE CONSTRAINT TRIGGER "JournalLine_loan_check" AFTER INSERT OR UPDATE OR DELETE ON "JournalLine" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "loan_final_check"();
