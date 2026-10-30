"use client";
import { usePathname,useSearchParams } from "next/navigation";
import { useFiscalContext } from "./fiscal-context";
import { fiscalHref,selectedYear,requiresSingleFiscalYear } from "@/lib/fiscal/selection";
export function useFiscalHref(){
  const path=usePathname(),params=useSearchParams(),context=useFiscalContext();
  const allowAll=!requiresSingleFiscalYear(path);
  const year=selectedYear(params.get("year")??undefined,context.years,allowAll?context.preferredYear:context.defaultYear,allowAll);
  return(href:string)=>fiscalHref(href,year,context.defaultYear,path);
}
