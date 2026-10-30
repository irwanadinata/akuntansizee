"use server";
import { cookies,headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { YEAR_COOKIE } from "@/lib/fiscal/selection";
export async function selectFiscalYear(raw:unknown) {
  await requireAdmin();
  try{
    assertTrustedOrigin((await headers()).get("origin"),getAuthEnv().APP_ORIGIN);
    const value=z.string().regex(/^(all|\d{4})$/).parse(raw);
    if(value!=="all"&&!await getPrisma().fiscalYear.findUnique({where:{year:Number(value)},select:{id:true}}))return{ok:false,message:"Tahun buku tidak ditemukan."};
    (await cookies()).set(YEAR_COOKIE,value,{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",path:"/",maxAge:60*60*24*30});
    return{ok:true,message:"Tahun buku dipilih."};
  }catch{return{ok:false,message:"Tahun buku belum dapat dipilih. Coba kembali."};}
}
