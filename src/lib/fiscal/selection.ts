export const YEAR_COOKIE="zee-fiscal-year";
export function requiresSingleFiscalYear(path:string){return["/neraca","/laba-rugi","/laporan-keuangan","/saldo-pembukaan"].some(route=>path===route||path.startsWith(route+"/"));}
export type YearOption={id:string;year:number;status:"OPEN"|"LOCKED"};
export function selectedYear(raw:string|undefined,years:YearOption[],fallback:string,allowAll=true) {
  if(raw==="all"||raw==="")return allowAll?"":fallback;
  if(raw&&years.some(year=>String(year.year)===raw))return raw;
  return fallback;
}
export function defaultFiscalYear(years:YearOption[],cookie:string|undefined,currentYear:number) {
  if(cookie&&years.some(year=>String(year.year)===cookie))return cookie;
  return String(years.find(year=>year.year===currentYear)?.year??years[0]?.year??"");
}
export function fiscalDate(year:string,today:string) {return year&&year!=="all"&&year!==today.slice(0,4)?year+"-01-01":today;}
export function fiscalHref(href:string,year:string,fallback:string,currentPath="/") {
  if(!href.startsWith("/")&&!href.startsWith("?"))return href;
  if(href.startsWith("//")||href.startsWith("/login"))return href;
  const url=new URL(href,"http://internal"+currentPath);
  if(!url.searchParams.has("year")){
    const report=requiresSingleFiscalYear(url.pathname);
    url.searchParams.set("year",report?(year||fallback):(year||"all"));
  }
  return url.pathname+"?"+url.searchParams.toString()+url.hash;
}
