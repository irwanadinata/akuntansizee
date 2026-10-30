import { randomUUID } from "node:crypto";
import { calculateStatements,type AccountTotals } from "../../src/lib/reports/calculation";
import type { FinancialReport } from "../../src/lib/reports/engine";
import type { ledgerReport } from "../../src/lib/ledger/report";
// Synthetic immutable input fixtures only. Renderers receive stored-looking
// identifiers; they never generate a transaction number.
export function syntheticReport():FinancialReport{
  const account=(code:string,name:string,mainType:string,reportGroup:string,net:string):AccountTotals=>({id:randomUUID(),code,name,mainType,reportGroup,normalBalance:["ASSET","EXPENSE","COGS"].includes(mainType)?"DEBIT":"CREDIT",isContra:false,isControlAccount:false,requiresReview:false,reviewed:true,cumulative:net,prior:"0",yearToDate:net,period:net,hasPosted:true});
  const accounts=[account("1111.1","Kas sintetis","ASSET","CASH_BANK","3000000"),account("4000.1","Pendapatan sintetis","REVENUE","OPERATING_REVENUE","-10000000"),account("5000.1","HPP sintetis","COGS","COST_OF_SALES","6000000"),account("6000.1","Beban sintetis","EXPENSE","OPERATING_EXPENSE","1000000")];
  return{filter:{year:2037,from:"2037-01-01",to:"2037-12-31",hideZero:true},year:{id:randomUUID(),year:2037,status:"OPEN"},...calculateStatements(accounts),accounts,
    diagnostics:{warnings:[],canUse:true,trialDebit:"17000000",trialCredit:"17000000",trialDifference:"0",invalidJournals:[],reconciliations:[{code:"1121.1",name:"Piutang Usaha",control:"0",detail:"0",difference:"0"}],manualClosingCount:0},
    sources:["10000000","6000000","1000000"].map((amount,index)=>({id:randomUUID(),date:"2037-01-01",postedAt:"2037-01-01T01:00:00.000Z",journalNumber:"JRN-20370101-ABCDEF12345"+index,businessNumber:null,parentNumber:null,description:"Data uji sintetis",debit:amount,credit:amount})),sourceCount:3,sourcePage:1,sourcePages:1,sourceScope:"cumulative",generatedAt:"2037-12-31T03:00:00.000Z"};
}
export function syntheticLedger():Awaited<ReturnType<typeof ledgerReport>>{
  return{year:{year:2037,status:"LOCKED"},account:{id:randomUUID(),code:"1111.1",name:"Kas sintetis",normalBalance:"DEBIT",isContra:false},opening:"1000000",closing:"99999999999999999999",debit:"99999999999999999999",credit:"1000000",count:2,page:1,pages:1,
    rows:[{id:randomUUID(),entryId:randomUUID(),date:"2037-12-31",journalNumber:"JRN-20371231-ABCDEF123456",businessNumber:"BYC-20371231-ABCDEF123456",parentNumber:"PIU-20370101-ABCDEF123456",description:"Uji presisi saja",debit:"99999999999999999999",credit:"0",balance:"100000000000000999999"},{id:randomUUID(),entryId:randomUUID(),date:"2037-12-31",journalNumber:"JRN-20371231-ABCDEF123457",businessNumber:null,parentNumber:null,description:"Uji presisi saja",debit:"0",credit:"1000000",balance:"99999999999999999999"}]};
}
