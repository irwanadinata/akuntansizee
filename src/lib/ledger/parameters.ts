import "server-only";
import { z } from "zod";
import { withFiscalYear } from "../fiscal/context";
import { jakartaDate } from "../accounting/dates";
import type { SearchParams } from "../reports/parameters";
export async function ledgerParameters(params:SearchParams){
  const scope=await withFiscalYear(params),text=(key:string)=>typeof params[key]==="string"?params[key] as string:"";
  const legacy=scope.years.find(year=>year.id===text("fiscalYearId"));
  const activeYear=params.year===undefined&&legacy?String(legacy.year):scope.year,selected=scope.years.find(year=>String(year.year)===activeYear),today=jakartaDate();
  const from=text("from")||(activeYear?activeYear+"-01-01":today.slice(0,4)+"-01-01"),to=text("to")||(activeYear&&activeYear!==today.slice(0,4)?activeYear+"-12-31":today);
  return{...scope,year:activeYear,raw:{accountId:text("accountId"),...(selected?{fiscalYearId:selected.id}:{}),from,to,page:z.coerce.number().int().min(1).max(100000).catch(1).parse(text("page")||1)}};
}
