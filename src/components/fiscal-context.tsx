"use client";
import { createContext,useContext,type ReactNode } from "react";
import type { YearOption } from "@/lib/fiscal/selection";
type Context={years:YearOption[];defaultYear:string;preferredYear:string};
const FiscalContext=createContext<Context>({years:[],defaultYear:"",preferredYear:""});
export function FiscalProvider({value,children}:{value:Context;children:ReactNode}) {return <FiscalContext.Provider value={value}>{children}</FiscalContext.Provider>;}
export function useFiscalContext(){return useContext(FiscalContext);}
