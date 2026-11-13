"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { previewOpening,postOpening,type OpeningPreview,type OpeningResult } from "@/lib/opening/engine";
import { JournalError } from "@/lib/journal/validation";
function message(error:unknown){
  if(error instanceof z.ZodError)return error.issues[0]?.message??"Isian tidak sah.";
  if(error instanceof JournalError)return error.message;
  return "Proses belum berhasil atau data sedang berubah. Tidak ada penyimpanan sebagian. Periksa preview dan ulangi permintaan yang sama.";
}
export async function previewOpeningAction(raw:unknown):Promise<{ok:boolean;message:string;preview?:OpeningPreview}>{
  await requireAdmin();
  try{assertTrustedOrigin((await headers()).get("origin"),getAuthEnv().APP_ORIGIN);return{ok:true,message:"Preview siap diperiksa. Belum ada jurnal disimpan.",preview:await previewOpening(getPrisma(),raw)};}
  catch(error){return{ok:false,message:message(error)};}
}
export async function postOpeningAction(raw:unknown):Promise<{ok:boolean;message:string;result?:OpeningResult}>{
  const admin=await requireAdmin();
  try{
    assertTrustedOrigin((await headers()).get("origin"),getAuthEnv().APP_ORIGIN);
    const result=await postOpening(getPrisma(),admin.id,raw);
    for(const path of["/saldo-pembukaan","/jurnal","/buku-besar","/neraca","/laba-rugi","/laporan-keuangan","/coa","/tahun-buku","/"])revalidatePath(path);
    return{ok:true,message:"Saldo pembukaan berhasil dicatat — "+result.journalNumber,result};
  }catch(error){return{ok:false,message:message(error)};}
}
