"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { TradeError,tradeKinds } from "@/lib/trade/validation";
import { JournalError } from "@/lib/journal/validation";
import { executeTradeCommand,tradeOperations,type TradeResult } from "@/lib/trade/engine";
export type TradeActionResult = { ok:boolean;message:string;result?:TradeResult };
export async function tradeAction(kind: unknown, operation: unknown, payload: unknown): Promise<TradeActionResult> {
  const admin=await requireAdmin();
  try {
    assertTrustedOrigin((await headers()).get("origin"),getAuthEnv().APP_ORIGIN);
    const domain=z.enum(tradeKinds).parse(kind),action=z.enum(tradeOperations).parse(operation);
    const result=await executeTradeCommand(getPrisma(),admin.id,domain,action,payload);
    const base=domain==="RECEIVABLE"?"/piutang-customer":"/utang-supplier";
    for(const path of [base,"/jurnal","/buku-besar","/coa"])revalidatePath(path);
    revalidatePath(base+"/[id]","page");revalidatePath("/jurnal/[id]","page");
    return {ok:true,message:result.reversed?"Pembatalan berhasil dicatat — Jurnal "+result.journalNumber:
      (action==="CREATE_DOCUMENT"?"Tagihan":"Pembayaran")+" berhasil dicatat — Nomor "+result.number,result};
  }catch(error){
    if(error instanceof TradeError||error instanceof JournalError)return{ok:false,message:error.message};
    if(error instanceof z.ZodError)return{ok:false,message:error.issues[0]?.message??"Input tidak sah."};
    const code=error&&typeof error==="object"&&"code"in error?error.code:null;
    if(code==="P2002"||code==="P2034"||code==="P2025")return{ok:false,message:"Transaksi sedang berubah atau nomor bentrok. Muat ulang atau ulangi permintaan yang sama."};
    return{ok:false,message:"Tagihan/pembayaran belum dapat disimpan. Tidak ada perubahan sebagian pada jurnal atau rincian. Ulangi permintaan yang sama atau hubungi pengelola."};
  }
}
