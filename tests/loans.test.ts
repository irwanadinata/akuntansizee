import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createLoanSchema,createPaymentSchema,positiveRupiah,EMPLOYEE_CONTROL_CODE } from "../src/lib/loans/validation";
import { loanFilters } from "../src/lib/loans/queries";
import { newPublicNumber,isNumberCollision,boundedCommand } from "../src/lib/journal/identity";
test("pinjaman memakai satu kontrol dari mapping sah; nama disimpan pada Loan",()=>{
  const approved=JSON.parse(readFileSync(new URL("../prisma/coa-approved.json",import.meta.url),"utf8"));
  const account=approved.accounts.find((a:{code:string})=>a.code===EMPLOYEE_CONTROL_CODE);
  assert.equal(account.sourceRow,73);assert.equal(account.name,"Piutang Karyawan");assert.equal(account.isControlAccount,true);assert.equal(account.normalBalance,"DEBIT");
  const parsed=createLoanSchema.parse({employeeName:" Budi ",date:"2037-01-01",amount:"2.000.000",cashAccountId:randomUUID(),requestKey:randomUUID()});assert.equal(parsed.employeeName,"Budi");assert.equal(parsed.amount,"2000000");
});
test("nominal positif exact, tanggal/jatuh tempo dan input nomor manual ditolak",()=>{
  for(const value of [""," ","0","-2","1,5","1.5","1e3","100000000000000000000"])assert.equal(positiveRupiah.safeParse(value).success,false);
  assert.equal(positiveRupiah.parse("10000000000000001"),"10000000000000001");
  const input={employeeName:"Budi",date:"2037-01-01",amount:"1000",cashAccountId:randomUUID(),requestKey:randomUUID()};
  assert.equal(createLoanSchema.safeParse({...input,loanNumber:"PJM-manual"}).success,false);assert.equal(createLoanSchema.safeParse({...input,dueDate:"2036-12-31"}).success,false);assert.equal(createLoanSchema.safeParse({...input,date:"2037-02-30"}).success,false);
  const payment={loanId:randomUUID(),date:input.date,amount:"1000",cashAccountId:input.cashAccountId,requestKey:randomUUID()};
  assert.equal(createPaymentSchema.safeParse({...payment,paymentNumber:"CIC-manual"}).success,false);
});
test("PJM/CIC memakai CSPRNG tanggal pembuatan WIB; collision hanya kolom nomor",async()=>{
  for(const prefix of ["PJM","CIC"] as const){const values=Array.from({length:1000},()=>newPublicNumber(prefix,new Date("2026-10-27T18:00:00Z")));assert.equal(new Set(values).size,1000);assert.ok(values.every(value=>new RegExp("^"+prefix+"-20261028-[A-F0-9]{12}$").test(value)));}
  const collision=(table:string,field:string)=>({code:"P2002",meta:{driverAdapterError:{cause:{kind:"UniqueConstraintViolation",table,constraint:{fields:['"'+field+'"']}}}}});
  assert.equal(isNumberCollision(collision("Loan","loanNumber")),true);assert.equal(isNumberCollision(collision("LoanPayment","paymentNumber")),true);assert.equal(isNumberCollision(collision("LoanPayment","journalEntryId")),false);assert.equal(isNumberCollision(collision("LoanRequest","requestKey")),false);
  let attempts=0;await assert.rejects(boundedCommand(async()=>{attempts++;throw collision("LoanPayment","paymentNumber");}));assert.equal(attempts,5);
});
test("filter nama/nomor/tahun/status dibatasi dan pagination mempunyai batas",()=>{
  assert.deepEqual(loanFilters.parse({q:" Budi ",year:"2037",status:"unpaid",page:"2"}),{q:"Budi",year:"2037",status:"unpaid",page:2});
  assert.equal(loanFilters.parse({year:"all",status:"unknown",page:"-1"}).page,1);assert.equal(loanFilters.parse({q:"%_"}).q,"%_");
});
