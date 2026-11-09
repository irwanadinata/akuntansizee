import assert from "node:assert/strict";
import test from "node:test";
import {sourceAuditActionLabel} from "../src/lib/journal/labels";
import {randomUUID} from "node:crypto";
import {journalNumberSchema,createJournalSchema,editJournalSchema} from "../src/lib/journal/validation";
import {sourceEditSchema} from "../src/lib/journal/source-validation";
import {executeJournalCommand} from "../src/lib/journal/engine";
import {openingFields} from "../src/lib/opening/validation";
import {createDocumentSchema,createPaymentSchema} from "../src/lib/trade/validation";
import type {PrismaClient} from "../src/generated/prisma/client";
const lines=[{accountId:randomUUID(),debit:"1000",credit:"0"},{accountId:randomUUID(),debit:"0",credit:"1000"}];
const value={journalNumber:" ju/2037/001 ",date:"2037-01-01",description:"Jurnal baru",lines,requestKey:randomUUID()};
test("nomor jurnal manual wajib, maksimal 40 karakter dan dinormalisasi uppercase",()=>{
 assert.equal(journalNumberSchema.parse(" ju/2037/001 "),"JU/2037/001");for(const number of[""," ","BAD NUMBER","<script>","X".repeat(41)])assert.equal(journalNumberSchema.safeParse(number).success,false);
 assert.equal(createJournalSchema.parse(value).journalNumber,"JU/2037/001");assert.equal(createJournalSchema.safeParse({...value,journalNumber:undefined}).success,false);
});
test("sekali simpan harus seimbang, edit memerlukan versi serta alasan",()=>{
 assert.equal(createJournalSchema.safeParse({...value,lines:[lines[0],{...lines[1],credit:"999"}]}).success,false);
 const update={...value,id:randomUUID(),version:2,reason:"Koreksi sesuai bukti"};assert.equal(editJournalSchema.safeParse(update).success,true);for(const extra of[{reason:""},{version:0},{id:"invalid"}])assert.equal(editJournalSchema.safeParse({...update,...extra}).success,false);
});
test("perintah draf lama ditolak sebelum akses database",async()=>{
 const db=new Proxy({},{get(){assert.fail("Operasi draf tidak boleh mengakses database")}})as PrismaClient;
 for(const operation of["CREATE_DRAFT","EDIT_DRAFT","DELETE_DRAFT","POST"])await assert.rejects(executeJournalCommand(db,randomUUID(),operation,{...value,id:randomUUID(),version:1}));
});
test("editor sumber mewajibkan versi sumber/induk dan menolak perubahan relasi",()=>{
 const input={id:randomUUID(),version:2,sourceVersion:1,parentVersion:2,sourceType:"LOAN_PAYMENT",journalNumber:"CIC/JU/1",date:"2037-01-02",amount:"100",cashAccountId:randomUUID(),reason:"Koreksi cicilan",requestKey:randomUUID()};assert.equal(sourceEditSchema.safeParse(input).success,true);
 for(const extra of[{sourceVersion:0},{parentVersion:undefined},{loanId:randomUUID()},{controlAccountId:randomUUID()},{sourceType:"REVERSAL"}])assert.equal(sourceEditSchema.safeParse({...input,...extra}).success,false);
});
test("transaksi harian dan pembukaan menerima nomor jurnal manual",()=>{
 const doc={partyName:"Customer",date:value.date,amount:"1000",counterAccountId:randomUUID(),journalNumber:"piu/001",requestKey:randomUUID()};assert.equal(createDocumentSchema("RECEIVABLE").parse(doc).journalNumber,"PIU/001");
 assert.equal(createPaymentSchema.parse({documentId:randomUUID(),date:value.date,amount:"100",cashAccountId:randomUUID(),journalNumber:"byr/001",requestKey:randomUUID()}).journalNumber,"BYR/001");
 assert.equal(openingFields.parse({journalNumber:"awal/001",fiscalYearId:randomUUID(),cutoverDate:value.date,verificationNote:"Saldo awal telah diverifikasi",lines:lines.map(line=>({accountId:line.accountId,side:line.debit!=="0"?"DEBIT":"CREDIT",amount:"1000"}))}).journalNumber,"AWAL/001");
});

test("audit perubahan transaksi ditampilkan sebagai diperbarui",()=>{assert.equal(sourceAuditActionLabel("CREATED"),"dicatat");assert.equal(sourceAuditActionLabel("UPDATED"),"diperbarui");assert.equal(sourceAuditActionLabel("REVERSED"),"dibatalkan");});
