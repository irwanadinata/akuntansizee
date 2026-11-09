import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {loadLocalEnv} from "../../scripts/load-env";
import {buildSeedPlan} from "../../src/lib/coa/seed-plan";
import {executeJournalCommand,journalSnapshot,type CommandResult} from "../../src/lib/journal/engine";
import {ledgerReport} from "../../src/lib/ledger/report";
import {isolatedNeon} from "./neon-schema";
import {seedLegacyUnposted} from "../fixtures/legacy-unposted";
import {seedLegacyReversal} from "../fixtures/legacy-reversal";
loadLocalEnv();
const enabled=process.env.JOURNAL_TEST_CONFIRM==="CREATE_TEMP_SCHEMA"&&Boolean(process.env.JOURNAL_TEST_DIRECT_URL||process.env.DIRECT_URL);
test("PostgreSQL: nomor manual, posting langsung dan pengeditan jurnal atomik",{skip:enabled?false:"Perlu target uji dan JOURNAL_TEST_CONFIRM=CREATE_TEMP_SCHEMA.",timeout:360000},async t=>{
 const isolated=await isolatedNeon(process.env.JOURNAL_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
 try{
  const admin=await db.adminUser.create({data:{email:"journal-test@example.invalid",passwordHash:"disabled-test-only-"+randomUUID()}});
  const plan=buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json",import.meta.url),"utf8"),JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json",import.meta.url),"utf8")));await db.account.createMany({data:plan});
  const all=await db.account.findMany(),cash=all.find(a=>a.reportGroup==="CASH_BANK")!,income=all.find(a=>a.mainType==="REVENUE"&&!a.isContra)!,expense=all.find(a=>a.mainType==="EXPENSE"&&!a.isContra)!,contra=all.find(a=>a.mainType==="ASSET"&&a.isContra)!;
  const run=(operation:string,payload:object)=>executeJournalCommand(db,admin.id,operation,{requestKey:randomUUID(),...payload});
  const lines=(amount:string)=>[{accountId:cash.id,debit:amount,credit:"0",description:"Kas"},{accountId:income.id,debit:"0",credit:amount,description:"Pendapatan"}];
  const create=(date:string,amount="100",number="JU/"+randomUUID().slice(0,12))=>run("CREATE",{date,journalNumber:number,description:"Jurnal sintetis",lines:lines(amount)});
  const snapshot=(id:string)=>db.journalEntry.findUniqueOrThrow({where:{id},include:{lines:{orderBy:{lineNo:"asc"}}}});
  const counts=async()=>({entries:await db.journalEntry.count(),lines:await db.journalLine.count(),numbers:await db.journalNumber.count(),audits:await db.auditEvent.count(),requests:await db.journalRequest.count()});
  const report=(from:string,to:string,page=1)=>ledgerReport(db,{accountId:cash.id,from,to,page});
  await run("CREATE_YEAR",{year:2037});await run("CREATE_YEAR",{year:2038});let original:CommandResult;
  await t.test("nomor pengguna dinormalisasi, sekali simpan langsung POSTED dan retry idempotent",async()=>{
   const payload={journalNumber:" ju/2037/001 ",date:"2037-01-05",description:"Jurnal awal",lines:lines("1000"),requestKey:randomUUID()};
   const [a,b]=await Promise.all([run("CREATE",payload),run("CREATE",payload)]);assert.deepEqual(a,b);original=a;
   assert.equal(a.journalNumber,"JU/2037/001");assert.equal(a.status,"POSTED");assert.equal(await db.journalEntry.count({where:{status:"DRAFT"}}),0);assert.equal((await report("2037-01-01","2037-01-31")).closing,"1000");
   const before=await counts();await assert.rejects(run("CREATE",{...payload,requestKey:randomUUID()}),/sudah pernah digunakan/);assert.deepEqual(await counts(),before);
   await assert.rejects(run("CREATE",{...payload,description:"Isi berbeda"}),/isi berbeda/);
  });
  await t.test("nomor kosong/karakter tak sah dan jurnal tidak seimbang ditolak tanpa perubahan sebagian",async()=>{
   const before=await counts();for(const journalNumber of[""," ","BAD NUMBER","X".repeat(41)])await assert.rejects(create("2037-01-05","100",journalNumber));
   await assert.rejects(run("CREATE",{journalNumber:"JU/UNBALANCED",date:"2037-01-05",description:"Tidak seimbang",lines:[lines("100")[0],lines("99")[1]]}),/sama persis/);assert.deepEqual(await counts(),before);
  });
  await t.test("edit nomor, tanggal, akun/nominal mengganti pengaruh saldo serta mencatat sebelum/sesudah",async()=>{
   const stored=await snapshot(original.id),postedAt=stored.postedAt!.toISOString(),payload={id:stored.id,version:stored.version,journalNumber:"JU/2037/001A",date:"2037-02-01",description:"Nominal diperbaiki",lines:lines("500"),reason:"Koreksi nominal dan tanggal",requestKey:randomUUID()};
   const updated=await run("UPDATE",payload);assert.deepEqual(await run("UPDATE",payload),updated);assert.equal(updated.id,original.id);assert.equal(updated.status,"POSTED");
   const after=await snapshot(original.id);assert.equal(after.postedAt!.toISOString(),postedAt);assert.equal(after.lines[0].debit.toFixed(0),"500");assert.equal((await report("2037-01-01","2037-01-31")).closing,"0");assert.equal((await report("2037-02-01","2037-02-28")).closing,"500");
   const event=await db.auditEvent.findFirstOrThrow({where:{entityId:original.id,action:"EDITED"}}),details=event.details as {before:unknown;after:unknown};assert.deepEqual(details.before,journalSnapshot(stored));assert.deepEqual(details.after,journalSnapshot(after));
   await assert.rejects(create("2037-02-02","1","JU/2037/001"),/sudah pernah digunakan/);
  });
  await t.test("versi basi dan dua edit serentak tidak menimpa perubahan pihak lain",async()=>{
   const row=await snapshot(original.id),base={id:row.id,version:row.version,journalNumber:row.journalNumber,date:"2037-02-01",description:"Koreksi serentak",reason:"Pemeriksaan bukti"};
   const results=await Promise.allSettled([run("UPDATE",{...base,lines:lines("400")}),run("UPDATE",{...base,lines:lines("600")})]);assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
   const before=await counts();await assert.rejects(run("UPDATE",{...base,lines:lines("300")}),/sudah berubah/);assert.deepEqual(await counts(),before);
  });
  await t.test("DB menolak perubahan header/baris tanpa audit dan jejak audit tidak dapat dihapus",async()=>{
   await assert.rejects(db.journalEntry.update({where:{id:original.id},data:{description:"Mutasi tanpa audit",version:{increment:1}}}));await assert.rejects(db.journalLine.updateMany({where:{entryId:original.id},data:{debit:"999"}}));await assert.rejects(db.journalEntry.delete({where:{id:original.id}}));await assert.rejects(db.auditEvent.deleteMany({where:{entityId:original.id}}));
   await assert.rejects(db.$transaction(async tx=>{await tx.auditEvent.create({data:{entity:"JOURNAL",entityId:original.id,action:"EDITED",actorId:admin.id,details:{before:{},after:{},fromVersion:1,toVersion:2,transactionId:"0",reason:"Audit tidak sah"}}});}));
  });
  await t.test("operasi draf dan pembalik yang dihapus tidak dapat dipanggil lagi",async()=>{
   const before=await counts();for(const operation of["CREATE_DRAFT","EDIT_DRAFT","POST","DELETE_DRAFT","REVERSE"])await assert.rejects(run(operation,{id:original.id,version:2}));assert.deepEqual(await counts(),before);
  });
  await t.test("catatan lama belum terposting dapat dilengkapi lalu disimpan langsung",async()=>{
   const legacy=await seedLegacyUnposted(db,admin.id,"2037-03-01",lines("20"));assert.equal((await snapshot(legacy.id)).postingStatus,"DRAFT");
   const row=await run("UPDATE",{id:legacy.id,version:legacy.version,journalNumber:"JU/LEGACY",date:"2037-03-01",description:"Catatan lama dilengkapi",lines:lines("25"),reason:"Melengkapi catatan lama"});assert.equal(row.status,"POSTED");assert.equal((await snapshot(row.id)).lines[0].debit.toFixed(0),"25");
  });
  await t.test("akun kontrol manual diblokir, akun arsip tidak menerima penggunaan baru",async()=>{
   for(const account of all.filter(a=>a.isControlAccount))await assert.rejects(run("CREATE",{journalNumber:"JU/"+account.code,date:"2037-04-01",description:"Kontrol tanpa subledger",lines:[{accountId:account.id,debit:"1",credit:"0"},lines("1")[1]]}),/Akun kontrol/);
   await db.account.update({where:{id:cash.id},data:{isActive:false,version:{increment:1}}});await assert.rejects(create("2037-04-01"),/nonaktif/);await db.account.update({where:{id:cash.id},data:{isActive:true,version:{increment:1}}});
  });
  await t.test("kontra dan nominal 20 digit tetap exact saat create dan edit",async()=>{
   const amount="10000000000000001",input={journalNumber:"JU/PRECISION",date:"2037-05-01",description:"Presisi kontra",lines:[{accountId:expense.id,debit:amount,credit:"0"},{accountId:contra.id,debit:"0",credit:amount}]};const row=await run("CREATE",input);assert.equal((await ledgerReport(db,{accountId:contra.id,from:"2037-05-01",to:"2037-05-31"})).closing,amount);await run("UPDATE",{...input,id:row.id,version:row.version,lines:[{...input.lines[0],debit:"10000000000000002"},{...input.lines[1],credit:"10000000000000002"}],reason:"Koreksi satu Rupiah"});assert.equal((await ledgerReport(db,{accountId:contra.id,from:"2037-05-01",to:"2037-05-31"})).closing,"10000000000000002");
  });
  await t.test("riwayat pembalik lama tetap terbaca dan tidak dapat diedit",async()=>{
   const row=await create("2037-06-01","19"),before=await report("2037-06-01","2037-06-01");await seedLegacyReversal(db,admin.id,row.id,"2037-06-02");assert.equal((await report("2037-06-01","2037-06-01")).closing,before.closing);const stored=await snapshot(row.id);await assert.rejects(run("UPDATE",{id:stored.id,version:stored.version,journalNumber:stored.journalNumber,date:"2037-06-01",description:"Ubah riwayat",lines:lines("19"),reason:"Tidak boleh"}),/tidak dapat diedit/);
  });
  await t.test("pagination saldo berjalan tetap lengkap setelah pengeditan",async()=>{
   const before=BigInt((await report("2037-01-01","2037-12-31")).closing),many=Array.from({length:51},()=>({accountId:cash.id,debit:"1",credit:"0"}));many.push({accountId:income.id,debit:"0",credit:"51"});await run("CREATE",{journalNumber:"JU/PAGES",date:"2037-07-01",description:"Pagination saldo",lines:many});const page=await report("2037-07-01","2037-07-31",2);assert.equal(page.rows.length,1);assert.equal(page.count,51);assert.equal(page.rows[0].balance,(before+51n).toString());
  });
  await t.test("periode terkunci menolak create dan edit termasuk pindah ke tahun terbuka",async()=>{
   const fiscal=await db.fiscalYear.findUniqueOrThrow({where:{year:2037}}),entry=await snapshot(original.id);await run("SET_YEAR_STATUS",{id:fiscal.id,version:fiscal.version,status:"LOCKED",reason:"Tutup periode uji"});await assert.rejects(create("2037-12-31"),/terkunci/);await assert.rejects(run("UPDATE",{id:entry.id,version:entry.version,journalNumber:entry.journalNumber,date:"2038-01-01",description:"Pindah tahun",lines:lines("100"),reason:"Periode terkunci"}),/terkunci/);assert.equal((await create("2038-01-01")).status,"POSTED");
  });
 }finally{await isolated.cleanup();}
});
