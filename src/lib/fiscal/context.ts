import "server-only";
import { cookies } from "next/headers";
import { getPrisma } from "../db";
import { jakartaDate } from "../accounting/dates";
import { defaultFiscalYear,selectedYear,YEAR_COOKIE } from "./selection";
export async function fiscalContext() {
  const years=await getPrisma().fiscalYear.findMany({select:{id:true,year:true,status:true},orderBy:{year:"desc"}});
  const cookie=(await cookies()).get(YEAR_COOKIE)?.value;
  const defaultYear=defaultFiscalYear(years,cookie,Number(jakartaDate().slice(0,4)));
  return{years,defaultYear,preferredYear:cookie==="all"?"":defaultYear};
}
export async function withFiscalYear(params:Record<string,string|string[]|undefined>,allowAll=true) {
  const context=await fiscalContext(),raw=typeof params.year==="string"?params.year:undefined;
  return{...context,year:selectedYear(raw,context.years,allowAll?context.preferredYear:context.defaultYear,allowAll)};
}
