import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { openingFields,postOpeningSchema,openingLines,assertOpeningAccount } from "../src/lib/opening/validation";
import { fiscalHref,requiresSingleFiscalYear } from "../src/lib/fiscal/selection";
const input=()=>({fiscalYearId:randomUUID(),cutoverDate:"2037-01-01",verificationNote:"Referensi uji sintetis yang terpisah",lines:[{accountId:randomUUID(),side:"DEBIT" as const,amount:"2.000.000"},{accountId:randomUUID(),side:"CREDIT" as const,amount:"2000000"}]});
test("pembukaan manual menormalisasi Rupiah bulat dan mewajibkan jurnal seimbang positif",()=>{
  const data=openingFields.parse(input()),lines=openingLines(data);assert.equal(lines[0].debit,"2000000");assert.equal(lines[0].credit,"0");assert.equal(lines[1].credit,"2000000");
  assert.throws(()=>openingLines({...data,lines:[data.lines[0],{...data.lines[1],amount:"1999999"}]}),/sama persis/);
  for(const amount of["0","","-1","1,5","1e3","100000000000000000000"])assert.equal(openingFields.safeParse({...input(),lines:[{...input().lines[0],amount},input().lines[1]]}).success,false);
});
test("cutover/referensi/akun neto/preview/konfirmasi/kunci wajib; field nomor/saldo manual ditolak",()=>{
  const value=input(),post={...value,previewHash:"a".repeat(64),confirmed:true,requestKey:randomUUID()};assert.equal(postOpeningSchema.safeParse(post).success,true);
  for(const extra of[{cutoverDate:"2037-02-30"},{verificationNote:""},{lines:[value.lines[0],value.lines[0]]},{journalNumber:"JRN-MANUAL"},{balance:"1"}])assert.equal(openingFields.safeParse({...value,...extra}).success,false);
  for(const extra of[{confirmed:false},{confirmed:undefined},{previewHash:""},{requestKey:""},{journalNumber:"JRN-MANUAL"},{lines:[value.lines[0],value.lines[0]]}])assert.equal(postOpeningSchema.safeParse({...post,...extra}).success,false);
});
test("akun pembukaan wajib aktif/disetujui, klasifikasi sah dan tidak boleh kontrol; kontra sah diterima",()=>{
  const account={mainType:"ASSET" as const,reportGroup:"FIXED_ASSET",normalBalance:"CREDIT" as const,isContra:true,isControlAccount:false,isActive:true,reviewedAt:new Date()};assert.doesNotThrow(()=>assertOpeningAccount(account));
  assert.throws(()=>assertOpeningAccount({...account,reviewedAt:null}),/disetujui/);assert.throws(()=>assertOpeningAccount({...account,isActive:false}),/aktif/);assert.throws(()=>assertOpeningAccount({...account,isControlAccount:true}),/subledger/);assert.throws(()=>assertOpeningAccount({...account,reportGroup:"CAPITAL"}),/Klasifikasi/);
});
test("menu pembukaan opsional memakai satu Tahun Buku dan tidak menghilangkan preferensi tahun",()=>{
  assert.equal(requiresSingleFiscalYear("/saldo-pembukaan"),true);assert.equal(requiresSingleFiscalYear("/pinjaman-karyawan"),false);assert.equal(fiscalHref("/saldo-pembukaan","","2037"),"/saldo-pembukaan?year=2037");
});
