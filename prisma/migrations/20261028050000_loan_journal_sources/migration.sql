-- Commit enum additions before the following migration uses them.
ALTER TYPE "JournalSource" ADD VALUE 'LOAN';
ALTER TYPE "JournalSource" ADD VALUE 'LOAN_PAYMENT';
