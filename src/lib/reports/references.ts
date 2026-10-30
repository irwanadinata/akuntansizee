import { Prisma } from "../../generated/prisma/client";
// e is the JournalEntry alias. All public identifiers are read from persisted
// subledgers, including when this journal is their linked reversal.
export const referenceJoins=Prisma.sql`
 LEFT JOIN "Loan" ref_loan ON ref_loan."journalEntryId"=e."id" OR ref_loan."reversalEntryId"=e."id"
 LEFT JOIN "LoanPayment" ref_lp ON ref_lp."journalEntryId"=e."id" OR ref_lp."reversalEntryId"=e."id"
 LEFT JOIN "Loan" ref_lp_parent ON ref_lp_parent."id"=ref_lp."loanId"
 LEFT JOIN "TradeDocument" ref_trade ON ref_trade."journalEntryId"=e."id" OR ref_trade."reversalEntryId"=e."id"
 LEFT JOIN "TradePayment" ref_tp ON ref_tp."journalEntryId"=e."id" OR ref_tp."reversalEntryId"=e."id"
 LEFT JOIN "TradeDocument" ref_tp_parent ON ref_tp_parent."id"=ref_tp."documentId"`;
export const referenceColumns=Prisma.sql`
 COALESCE(ref_loan."loanNumber",ref_lp."paymentNumber",ref_trade."documentNumber",ref_tp."paymentNumber") AS "businessNumber",
 COALESCE(ref_lp_parent."loanNumber",ref_tp_parent."documentNumber") AS "parentNumber"`;
