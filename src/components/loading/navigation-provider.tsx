"use client";
import { createContext, useCallback, useContext, useMemo, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

const NavigationContext = createContext<{navigate:(href:string,replace?:boolean,scroll?:boolean)=>void}|null>(null);
export function useNavigationLoading(){return useContext(NavigationContext);}
export function NavigationProvider({children}:{children:ReactNode}){
  const router=useRouter(),[pending,startTransition]=useTransition();
  const navigate=useCallback((href:string,replace=false,scroll=true)=>{startTransition(()=>{if(replace)router.replace(href,{scroll});else router.push(href,{scroll});});},[router]);
  const value=useMemo(()=>({navigate}),[navigate]);
  return <NavigationContext.Provider value={value}>{children}{pending&&<div data-navigation-loading data-print-hide role="status" className="pointer-events-none fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-xl border bg-background px-4 py-3 text-sm font-medium shadow-lg"><LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true"/>Memuat halaman…</div>}</NavigationContext.Provider>;
}
