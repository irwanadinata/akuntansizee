-- Separate gains/losses from revenue; metadata only, no balances or journals.
ALTER TYPE "AccountMainType" ADD VALUE 'OTHER_RESULT';
