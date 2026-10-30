-- COA classification invariants, independent of balances/journals.
-- The OTHER_RESULT enum value is introduced in the previous migration.
ALTER TABLE "Account"
  ADD CONSTRAINT "Account_code_format_check" CHECK ("code" ~ '^[0-9]+(\.[0-9]+)*$'),
  ADD CONSTRAINT "Account_normal_balance_check" CHECK (
    "normalBalance"::text = CASE
      WHEN "mainType"::text IN ('ASSET', 'COGS', 'EXPENSE')
        THEN CASE WHEN "isContra" THEN 'CREDIT' ELSE 'DEBIT' END
      ELSE CASE WHEN "isContra" THEN 'DEBIT' ELSE 'CREDIT' END
    END
  ),
  ADD CONSTRAINT "Account_control_not_contra_check" CHECK (NOT ("isControlAccount" AND "isContra")),
  ADD CONSTRAINT "Account_group_type_check" CHECK (
    ("mainType"::text = 'ASSET' AND "reportGroup" IN ('CASH_BANK','RECEIVABLE','CURRENT_ASSET','PREPAID','FIXED_ASSET','OTHER_ASSET'))
    OR ("mainType"::text = 'LIABILITY' AND "reportGroup" IN ('CURRENT_LIABILITY','LONG_TERM_LIABILITY','TAX_PAYABLE'))
    OR ("mainType"::text = 'EQUITY' AND "reportGroup" IN ('CAPITAL','RETAINED_EARNINGS','DIVIDENDS'))
    OR ("mainType"::text = 'REVENUE' AND "reportGroup" IN ('OPERATING_REVENUE','CONTRA_REVENUE','OTHER_INCOME'))
    OR ("mainType"::text = 'OTHER_RESULT' AND "reportGroup" = 'OTHER_RESULT')
    OR ("mainType"::text = 'COGS' AND "reportGroup" = 'COST_OF_SALES')
    OR ("mainType"::text = 'EXPENSE' AND "reportGroup" IN ('OPERATING_EXPENSE','OTHER_EXPENSE','INCOME_TAX_EXPENSE'))
  ),
  ADD CONSTRAINT "Account_reduction_group_check" CHECK (
    "reportGroup" NOT IN ('CONTRA_REVENUE','DIVIDENDS') OR "isContra"
  );

