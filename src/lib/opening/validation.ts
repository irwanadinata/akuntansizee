import { z } from "zod";
import { rupiah } from "../accounting/money";
import { businessDate,assertBalanced,JournalError } from "../journal/validation";
import { classificationSchema,type Classification } from "../coa/catalog";
export const openingLineSchema=z.object({accountId:z.uuid("Pilih akun yang sah."),side:z.enum(["DEBIT","CREDIT"]),amount:z.string().max(40).transform((value,ctx)=>{
  try{const amount=rupiah(value);if(BigInt(amount)<=0n)throw new Error("Nominal harus lebih dari nol.");return amount;}catch(error){ctx.addIssue({code:"custom",message:error instanceof Error?error.message:"Nominal tidak sah."});return z.NEVER;}
})}).strict();
export const openingFields=z.object({fiscalYearId:z.uuid("Pilih Tahun Buku."),cutoverDate:businessDate,verificationNote:z.string().trim().min(10,"Tuliskan rujukan verifikasi terpisah, minimal 10 karakter.").max(1000),lines:z.array(openingLineSchema).min(2,"Minimal dua akun.").max(100,"Maksimal 100 akun.")}).strict().refine(value=>new Set(value.lines.map(line=>line.accountId)).size===value.lines.length,{message:"Satu akun hanya boleh diisi satu kali. Gunakan saldo neto akun yang telah diverifikasi.",path:["lines"]});
export const postOpeningSchema=openingFields.safeExtend({previewHash:z.string().regex(/^[a-f0-9]{64}$/, "Periksa preview terlebih dahulu."),confirmed:z.literal(true,{error:"Konfirmasi admin wajib dicentang."}),requestKey:z.uuid()}).strict();
export type OpeningInput=z.output<typeof openingFields>;
export function openingLines(input:OpeningInput){
  const lines=input.lines.map(line=>({accountId:line.accountId,debit:line.side==="DEBIT"?line.amount:"0",credit:line.side==="CREDIT"?line.amount:"0",description:"Saldo pembukaan terverifikasi"}));
  assertBalanced(lines);return lines;
}
export function assertOpeningAccount(account:Omit<Classification,"reportGroup">&{reportGroup:string;isActive:boolean;reviewedAt:Date|null}){
  if(account.isControlAccount)throw new JournalError("Akun kontrol Piutang Usaha, Utang Usaha dan Piutang Karyawan memerlukan rincian migrasi subledger; tidak dapat diisi melalui saldo pembukaan manual ini.");
  if(!account.isActive||!account.reviewedAt)throw new JournalError("Saldo pembukaan hanya menerima akun aktif dengan klasifikasi yang sudah disetujui. Periksa dan konfirmasi review melalui COA.");
  const {mainType,reportGroup,normalBalance,isContra,isControlAccount}=account;
  if(!classificationSchema.safeParse({mainType,reportGroup,normalBalance,isContra,isControlAccount}).success)throw new JournalError("Klasifikasi akun belum sah untuk saldo pembukaan.");
}
