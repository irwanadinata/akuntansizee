import { classificationSchema, groupLabel } from "../coa/catalog";
export type AccountTotals = { id:string;code:string;name:string;mainType:string;reportGroup:string;normalBalance:string;isContra:boolean;isControlAccount:boolean;requiresReview:boolean;reviewed:boolean;
  cumulative:string;prior:string;yearToDate:string;period:string;hasPosted?:boolean };
export type ReportRow = { id:string;code:string;name:string;amount:string;contra:boolean };
export type ReportSection = { key:string;label:string;rows:ReportRow[];total:string };
const sum = (values: string[]) => values.reduce((total,value)=>total+BigInt(value),0n).toString();
const pnlTypes = ["REVENUE","COGS","EXPENSE","OTHER_RESULT"];
const creditTypes = ["LIABILITY","EQUITY","REVENUE","OTHER_RESULT"];
function signed(account:AccountTotals,field:keyof Pick<AccountTotals,"cumulative"|"prior"|"yearToDate"|"period">) {
  const net=BigInt(account[field]); return (creditTypes.includes(account.mainType)?-net:net).toString();
}
function profit(accounts:AccountTotals[],field:"prior"|"yearToDate"|"period") {
  return accounts.filter(a=>pnlTypes.includes(a.mainType)).reduce((total,a)=>total-BigInt(a[field]),0n).toString();
}
export function calculateStatements(accounts:AccountTotals[]) {
  const mappingWarnings=accounts.filter(account=>(account.hasPosted||[account.cumulative,account.prior,account.yearToDate,account.period].some(value=>value!=="0"))&&(!classificationSchema.safeParse({mainType:account.mainType,reportGroup:account.reportGroup,normalBalance:account.normalBalance,isContra:account.isContra,isControlAccount:account.isControlAccount}).success || (account.requiresReview&&!account.reviewed))).map(a=>a.code+" · "+a.name+": klasifikasi/review akun perlu diperiksa.");
  const sections=(groups:string[],field:"cumulative"|"period"):ReportSection[]=>groups.map(key=>{
    const rows=accounts.filter(a=>a.reportGroup===key).map(a=>({id:a.id,code:a.code,name:a.name,amount:signed(a,field),contra:a.isContra}));
    return{key,label:groupLabel(key),rows,total:sum(rows.map(row=>row.amount))};
  });
  const assets=sections(["CASH_BANK","RECEIVABLE","CURRENT_ASSET","PREPAID","FIXED_ASSET","OTHER_ASSET"],"cumulative");
  const liabilities=sections(["CURRENT_LIABILITY","TAX_PAYABLE","LONG_TERM_LIABILITY"],"cumulative");
  const equity=sections(["CAPITAL","RETAINED_EARNINGS","DIVIDENDS"],"cumulative");
  // Only the residual P&L balances are added. Profit already transferred to an
  // equity account is therefore never added a second time.
  const priorUnclosed=profit(accounts,"prior"),currentProfit=profit(accounts,"yearToDate");
  const totalAssets=sum(assets.map(s=>s.total)),totalLiabilities=sum(liabilities.map(s=>s.total));
  const postedEquity=sum(equity.map(s=>s.total)),totalEquity=(BigInt(postedEquity)+BigInt(priorUnclosed)+BigInt(currentProfit)).toString();
  const revenue=sections(["OPERATING_REVENUE","CONTRA_REVENUE","OTHER_INCOME"],"period"),cogs=sections(["COST_OF_SALES"],"period");
  const expenses=sections(["OPERATING_EXPENSE","OTHER_EXPENSE"],"period"),otherResults=sections(["OTHER_RESULT"],"period"),taxes=sections(["INCOME_TAX_EXPENSE"],"period");
  const totalRevenue=sum(revenue.map(s=>s.total)),totalCogs=sum(cogs.map(s=>s.total)),grossProfit=(BigInt(totalRevenue)-BigInt(totalCogs)).toString();
  const totalExpenses=sum(expenses.map(s=>s.total)),otherResult=sum(otherResults.map(s=>s.total)),taxExpense=sum(taxes.map(s=>s.total));
  const beforeTax=(BigInt(grossProfit)-BigInt(totalExpenses)+BigInt(otherResult)).toString(),netProfit=(BigInt(beforeTax)-BigInt(taxExpense)).toString();
  return{balance:{assets,liabilities,equity,totalAssets,totalLiabilities,postedEquity,priorUnclosed,currentProfit,totalEquity,
    liabilitiesAndEquity:(BigInt(totalLiabilities)+BigInt(totalEquity)).toString(),difference:(BigInt(totalAssets)-BigInt(totalLiabilities)-BigInt(totalEquity)).toString()},
    income:{revenue,cogs,expenses,otherResults,taxes,totalRevenue,totalCogs,grossProfit,totalExpenses,otherResult,taxExpense,beforeTax,netProfit},mappingWarnings};
}
