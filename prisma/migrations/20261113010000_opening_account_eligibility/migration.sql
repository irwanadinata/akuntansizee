-- Ordinary active COA need no separate review approval, matching transaction account choices.
-- Required reviews, account classification, normal sides and all existing journal guards remain enforced.
-- No account metadata, review timestamps, balances or journals are changed.

CREATE OR REPLACE FUNCTION "opening_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    IF EXISTS(SELECT 1 FROM "JournalLine" l JOIN "Account" a ON a."id"=l."accountId" WHERE l."entryId"=target AND (a."isControlAccount" OR NOT a."isActive" OR (a."requiresReview" AND a."reviewedAt" IS NULL))) THEN
      RAISE EXCEPTION 'Pembukaan hanya untuk akun aktif, disetujui dan tanpa akun kontrol manual.' USING ERRCODE='23514';
    END IF;
    IF (SELECT COUNT(*)<>COUNT(DISTINCT "accountId") FROM "JournalLine" WHERE "entryId"=target) THEN
      RAISE EXCEPTION 'Saldo pembukaan per akun wajib neto, tanpa akun berulang.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION "journal_final_check"() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target UUID; e "JournalEntry"%ROWTYPE; origin "JournalEntry"%ROWTYPE; n BIGINT; d NUMERIC; c NUMERIC; per_account BOOLEAN;
BEGIN
 IF TG_TABLE_NAME='JournalLine' THEN target:=CASE WHEN TG_OP='DELETE' THEN OLD."entryId" ELSE NEW."entryId" END;
 ELSE target:=CASE WHEN TG_OP='DELETE' THEN OLD."id" ELSE NEW."id" END; END IF;
 SELECT * INTO e FROM "JournalEntry" WHERE "id"=target;
 IF NOT FOUND THEN RETURN NULL; END IF;
 per_account:=EXISTS(SELECT 1 FROM "OpeningJournal" WHERE "journalEntryId"=target AND "perAccount");
 SELECT COUNT(*),COALESCE(SUM("debit"),0),COALESCE(SUM("credit"),0) INTO n,d,c FROM "JournalLine" WHERE "entryId"=e."id";
 IF n<(CASE WHEN per_account THEN 1 ELSE 2 END) OR n>100 THEN
   RAISE EXCEPTION 'Jumlah baris jurnal tidak sah (pembukaan per COA minimal satu, jurnal biasa minimal dua; maksimal 100).' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM "JournalLine" l WHERE l."entryId"=e."id" AND NOT EXISTS (
   SELECT 1 FROM "AccountUsage" u WHERE u."accountId"=l."accountId" AND u."sourceType"='JOURNAL' AND u."sourceId"=e."id"::text
 )) THEN RAISE EXCEPTION 'Marker pemakaian akun wajib ada.' USING ERRCODE='23514'; END IF;
 IF per_account THEN
   IF e."sourceType"<>'MANUAL' OR e."reverseOfId" IS NOT NULL OR e."status"<>'POSTED' OR e."postingStatus"<>'POSTED' THEN
     RAISE EXCEPTION 'Saldo pembukaan per COA harus terposting melalui alur pembukaan.' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM "JournalLine" l JOIN "Account" a ON a."id"=l."accountId" WHERE l."entryId"=target
     AND (a."isControlAccount" OR NOT a."isActive" OR (a."requiresReview" AND a."reviewedAt" IS NULL)
       OR (a."normalBalance"='DEBIT' AND l."credit"<>0) OR (a."normalBalance"='CREDIT' AND l."debit"<>0)))
     OR n<>(SELECT COUNT(DISTINCT "accountId") FROM "JournalLine" WHERE "entryId"=target) THEN
     RAISE EXCEPTION 'Saldo pembukaan per COA wajib neto, sesuai saldo normal, aktif dan disetujui tanpa akun kontrol.' USING ERRCODE='23514';
   END IF;
 END IF;
 IF e."postingStatus"='POSTED' THEN
   IF NOT per_account AND (d<=0 OR d<>c) THEN RAISE EXCEPTION 'Debit dan kredit harus seimbang dan positif.' USING ERRCODE='23514'; END IF;
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
