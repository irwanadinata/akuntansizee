import "server-only";
import { withFiscalYear } from "../fiscal/context";
import { jakartaDate } from "../accounting/dates";
import { ReportError,reportFilters } from "./validation";
export type SearchParams=Record<string,string|string[]|undefined>;
export async function reportParameters(params:SearchParams) {
  const scope=await withFiscalYear(params,false);
  if(!scope.year)throw new ReportError("Belum ada Tahun Buku. Tambahkan tahun sebelum melihat laporan.");
  const text=(name:string)=>typeof params[name]==="string"?params[name] as string:undefined;
  const today=jakartaDate(),year=Number(scope.year);
  const filter=reportFilters.parse({year,from:text("from")||scope.year+"-01-01",to:text("to")||text("asOf")||(today.slice(0,4)===scope.year?today:scope.year+"-12-31"),hideZero:text("hideZero")!=="false"});
  return{...scope,filter};
}
