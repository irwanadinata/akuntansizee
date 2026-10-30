-- Enum values must be committed before the next migration uses them.
-- Identity/schema changes only; no journals, balances, or account data inserted.
ALTER TYPE "JournalSource" ADD VALUE 'TRADE_DOCUMENT';
ALTER TYPE "JournalSource" ADD VALUE 'TRADE_PAYMENT';
