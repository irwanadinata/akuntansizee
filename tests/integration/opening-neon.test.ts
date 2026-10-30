import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadLocalEnv } from "../../scripts/load-env";
import { isolatedNeon } from "./neon-schema";
import { buildSeedPlan } from "../../src/lib/coa/seed-plan";
import { executeJournalCommand,reserve,writeLines,audit } from "../../src/lib/journal/engine";
import { newJournalNumber } from "../../src/lib/journal/identity";
import { openingFields,openingLines } from "../../src/lib/opening/validation";
import { postOpening,previewOpening } from "../../src/lib/opening/engine";
import { financialReport } from "../../src/lib/reports/engine";
import { ledgerReport } from "../../src/lib/ledger/report";
import { editAccountInTransaction } from "../../src/lib/coa/mutations";
loadLocalEnv();
const enabled=process.env.OPENING_TEST_CONFIRM==="CREATE_TEMP_SCHEMA"&&Boolean(process.env.OPENING_TEST_DIRECT_URL||process.env.DIRECT_URL);
test("Neon: saldo pembukaan opsional, terverifikasi, atomik dan sekali per perusahaan",{skip:enabled?false:"Butuh Neon test/development dan OPENING_TEST_CONFIRM=CREATE_TEMP_SCHEMA.",timeout:360000},async t=>{
  const isolated=await isolatedNeon(process.env.OPENING_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
  try{
    const admin=await db.adminUser.create({data:{email:"opening-test@example.invalid",passwordHash:"test-disabled-"+randomUUID()}});
    const plan=buildSeedPlan(readFileSync(new URL("../../prisma/coa-source.json",import.meta.url),"utf8"),JSON.parse(readFileSync(new URL("../../prisma/coa-code-decisions.json",import.meta.url),"utf8")));await db.account.createMany({data:plan});
    const all=await db.account.findMany(),cash=all.find(a=>a.reportGroup==="CASH_BANK")!,capital=all.find(a=>a.reportGroup==="CAPITAL")!,asset=all.find(a=>a.reportGroup==="FIXED_ASSET"&&!a.isContra)!,contra=all.find(a=>a.reportGroup==="FIXED_ASSET"&&a.isContra)!,revenue=all.find(a=>a.mainType==="REVENUE"&&!a.isContra)!;
    for(const year of[2036,2037,2038])await executeJournalCommand(db,admin.id,"CREATE_YEAR",{year,requestKey:randomUUID()});
    const fiscal=await db.fiscalYear.findUniqueOrThrow({where:{year:2037}}),locked=await db.fiscalYear.findUniqueOrThrow({where:{year:2038}});
    await executeJournalCommand(db,admin.id,"SET_YEAR_STATUS",{id:locked.id,version:locked.version,status:"LOCKED",reason:"Uji sintetis tahun terkunci",requestKey:randomUUID()});
    const raw={fiscalYearId:fiscal.id,cutoverDate:"2037-01-01",verificationNote:"Verifikasi sintetis untuk pengujian terisolasi",lines:[{accountId:cash.id,side:"DEBIT",amount:"2000000"},{accountId:asset.id,side:"DEBIT",amount:"1000000"},{accountId:contra.id,side:"CREDIT",amount:"250000"},{accountId:capital.id,side:"CREDIT",amount:"2750000"}]};
    const counts=async()=>({entries:await db.journalEntry.count(),numbers:await db.journalNumber.count(),markers:await db.openingJournal.count(),requests:await db.journalRequest.count(),audits:await db.auditEvent.count(),usage:await db.accountUsage.count()});
    const failPost=(value:unknown)=>postOpening(db,admin.id,value);
    const postRaw=(extra:Record<string,unknown>={})=>({...raw,previewHash:"0".repeat(64),confirmed:true,requestKey:randomUUID(),...extra});
    await t.test("buku baru tetap nol; preview tidak membuat jurnal, nomor atau audit keuangan",async()=>{
      const before=await counts(),report=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});assert.equal(report.balance.totalAssets,"0");assert.equal(report.sourceCount,0);assert.equal(before.markers,0);
      const preview=await previewOpening(db,raw);assert.equal(preview.totalDebit,"3000000");assert.equal(preview.totalCredit,"3000000");assert.deepEqual(await counts(),before);
    });
    await t.test("tidak seimbang, nol, tanpa konfirmasi, tahun/tanggal salah dan locked ditolak atomik",async()=>{
      const before=await counts(),unbalanced={...raw,lines:raw.lines.map((line,index)=>index===3?{...line,amount:"2749999"}:line)};
      await assert.rejects(previewOpening(db,unbalanced),/sama persis/);await assert.rejects(failPost(postRaw({lines:unbalanced.lines})),/sama persis/);
      await assert.rejects(failPost(postRaw({confirmed:false})));await assert.rejects(failPost(postRaw({lines:raw.lines.map(line=>({...line,amount:"0"}))})));
      await assert.rejects(previewOpening(db,{...raw,fiscalYearId:locked.id}),/Tahun Buku aktif/);
      await assert.rejects(previewOpening(db,{...raw,fiscalYearId:locked.id,cutoverDate:"2038-01-01"}),/terkunci/);await assert.rejects(failPost(postRaw({fiscalYearId:locked.id,cutoverDate:"2038-01-01"})),/terkunci/);
      assert.deepEqual(await counts(),before);
    });
    await t.test("akun belum disetujui dan ketiga kontrol ditolak tanpa merusak rekonsiliasi",async()=>{
      const pending=await db.account.create({data:{code:"9900.1",name:"Akun uji belum disahkan",mainType:"ASSET",reportGroup:"CURRENT_ASSET",normalBalance:"DEBIT"}});
      const value={...raw,lines:raw.lines.map((line,index)=>index===0?{...line,accountId:pending.id}:line)},before=await counts();
      await assert.rejects(previewOpening(db,value),/disetujui/);await assert.rejects(failPost(postRaw({lines:value.lines})),/disetujui/);
      // Bypass service validation: the deferred DB guard must still roll back
      // the journal, lines, number reservation, usage markers and both audits.
      await assert.rejects(db.$transaction(async tx=>{
        const entry=await tx.journalEntry.create({data:{journalNumber:await reserve(tx,()=>new Date(),newJournalNumber),date:new Date("2037-01-01T00:00:00Z"),description:"Uji guard akun pembukaan belum disetujui",fiscalYearId:fiscal.id,createdById:admin.id}});
        await writeLines(tx,entry.id,openingLines(openingFields.parse(value)));
        const marker=await tx.openingJournal.create({data:{journalEntryId:entry.id,cutoverDate:entry.date,fiscalYearId:fiscal.id,verificationNote:raw.verificationNote,previewHash:"0".repeat(64),createdById:admin.id,confirmedAt:new Date()}});
        await tx.journalEntry.update({where:{id:entry.id},data:{status:"POSTED",postingStatus:"POSTED",postedAt:new Date(),postedById:admin.id,version:{increment:1}}});
        await audit(tx,admin.id,entry.id,"POSTED",{journalNumber:entry.journalNumber});await audit(tx,admin.id,marker.id,"OPENING_POSTED",{confirmed:true},"OPENING");
      }),/disetujui/);
      for(const account of all.filter(a=>a.isControlAccount))await assert.rejects(previewOpening(db,{...raw,lines:raw.lines.map((line,index)=>index===0?{...line,accountId:account.id}:line)}),/kontrol/);
      assert.deepEqual(await counts(),before);
      const approved=await db.$transaction(tx=>editAccountInTransaction(tx,admin.id,pending.id,pending.version,{code:pending.code,name:pending.name,description:"",mainType:"ASSET",reportGroup:"CURRENT_ASSET",normalBalance:"DEBIT",isContra:false,isControlAccount:false,isActive:true,requiresReview:false,reviewConfirmed:true,reviewReason:""}));assert.ok(approved.reviewedAt);assert.equal((await previewOpening(db,value)).totalDebit,"3000000");
    });
    await t.test("perubahan metadata setelah preview dan collision gagal penuh tidak menyimpan sebagian",async()=>{
      const preview=await previewOpening(db,raw);await db.account.update({where:{id:cash.id},data:{name:cash.name+" sintetis",version:{increment:1}}});const before=await counts();
      await assert.rejects(failPost({...preview.input,previewHash:preview.previewHash,confirmed:true,requestKey:randomUUID()}),/berubah setelah preview/);assert.deepEqual(await counts(),before);
      const current=await previewOpening(db,raw),reserved="JRN-20370101-CCCCCCCCCCCC";await db.journalNumber.create({data:{journalNumber:reserved}});const afterReserve=await counts();let attempts=0;
      await assert.rejects(postOpening(db,admin.id,{...current.input,previewHash:current.previewHash,confirmed:true,requestKey:randomUUID()},{number:()=>{attempts++;return reserved;}}));assert.equal(attempts,5);assert.deepEqual(await counts(),afterReserve);
    });
    const oldDraft=await executeJournalCommand(db,admin.id,"CREATE_DRAFT",{date:"2036-12-31",description:"Draf sintetis sebelum cutover",lines:[{accountId:cash.id,debit:"50",credit:"0"},{accountId:revenue.id,debit:"0",credit:"50"}],requestKey:randomUUID()});
    await t.test("transaksi dapat dimulai tanpa pembukaan; cutover melewati histori posted ditolak",async()=>{
      const first=await executeJournalCommand(db,admin.id,"CREATE_DRAFT",{date:"2037-01-01",description:"Transaksi sintetis pertama tanpa pembukaan",lines:[{accountId:cash.id,debit:"50",credit:"0"},{accountId:revenue.id,debit:"0",credit:"50"}],requestKey:randomUUID()});await executeJournalCommand(db,admin.id,"POST",{id:first.id,version:first.version,requestKey:randomUUID()});assert.equal(await db.openingJournal.count(),0);
      const before=await counts();await assert.rejects(previewOpening(db,{...raw,cutoverDate:"2037-01-02"}),/sebelum cutover/);await assert.rejects(failPost(postRaw({cutoverDate:"2037-01-02"})),/sebelum cutover/);assert.deepEqual(await counts(),before);
    });
    const preview=await previewOpening(db,raw),payload={...preview.input,previewHash:preview.previewHash,confirmed:true,requestKey:randomUUID()};
    let saved:Awaited<ReturnType<typeof postOpening>>,winning:typeof payload;
    await t.test("dua impor simultan dengan kunci berbeda menghasilkan tepat satu jurnal pembukaan",async()=>{
      const second={...payload,requestKey:randomUUID()},before=await counts(),responses=await Promise.allSettled([postOpening(db,admin.id,payload),postOpening(db,admin.id,second)]);
      assert.equal(responses.filter(r=>r.status==="fulfilled").length,1);const index=responses.findIndex(r=>r.status==="fulfilled"),success=responses[index];assert.equal(success.status,"fulfilled");if(success.status!=="fulfilled")throw new Error("Pembukaan tidak tersimpan");saved=success.value;winning=index===0?payload:second;
      const after=await counts();assert.equal(after.entries,before.entries+1);assert.equal(after.numbers,before.numbers+1);assert.equal(after.markers,1);assert.equal(after.requests,before.requests+1);assert.equal(after.audits,before.audits+2);assert.equal(after.usage,before.usage+4);assert.match(saved.journalNumber,/^JRN-\d{8}-[A-F0-9]{12}$/);
    });
    await t.test("retry kunci sama stabil; isi berbeda dan impor baru/lintas tahun tetap ditolak",async()=>{
      const before=await counts(),retries=await Promise.all([postOpening(db,admin.id,winning),postOpening(db,admin.id,winning)]);assert.deepEqual(retries[0],saved);assert.deepEqual(retries[1],saved);
      await assert.rejects(postOpening(db,admin.id,{...winning,verificationNote:"Isi verifikasi sintetis berbeda"}),/isi berbeda/);await assert.rejects(postOpening(db,admin.id,{...winning,requestKey:randomUUID()}),/sudah pernah/);assert.deepEqual(await counts(),before);
      await assert.rejects(db.openingJournal.create({data:{journalEntryId:saved.id,cutoverDate:new Date("2037-01-01T00:00:00Z"),fiscalYearId:fiscal.id,verificationNote:"Percobaan impor ganda sintetis",previewHash:preview.previewHash,createdById:admin.id,confirmedAt:new Date()}}));assert.equal(await db.openingJournal.count(),1);
    });
    await t.test("jurnal/penanda immutable, laporan seimbang, kontra dan ledger hanya dari posted",async()=>{
      const report=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});assert.equal(report.balance.totalAssets,"2750050");assert.equal(report.balance.difference,"0");assert.equal(report.diagnostics.canUse,true);assert.ok(report.sources.some(source=>source.journalNumber===saved.journalNumber));
      const ledger=await ledgerReport(db,{accountId:cash.id,from:"2037-01-02",to:"2037-12-31"});assert.equal(ledger.opening,"2000050");assert.equal(ledger.closing,"2000050");
      await assert.rejects(db.openingJournal.delete({where:{id:saved.openingId}}));await assert.rejects(db.openingJournal.update({where:{id:saved.openingId},data:{verificationNote:"Mengubah bukti setelah posting"}}));await assert.rejects(db.journalEntry.update({where:{id:saved.id},data:{description:"Ubah nominal diam-diam",version:{increment:1}}}));
      const before=await counts();await assert.rejects(executeJournalCommand(db,admin.id,"POST",{id:oldDraft.id,version:oldDraft.version,requestKey:randomUUID()}),/cutover/);assert.deepEqual(await counts(),before);
      await assert.rejects(db.$transaction(async tx=>{
        await audit(tx,admin.id,oldDraft.id,"POSTED",{journalNumber:oldDraft.journalNumber});
        await tx.journalEntry.update({where:{id:oldDraft.id},data:{status:"POSTED",postingStatus:"POSTED",postedAt:new Date(),postedById:admin.id,version:{increment:1}}});
      }),/cutover/);assert.deepEqual(await counts(),before);
    });
    await t.test("koreksi melalui pembalik menjaga histori dan tidak membuka impor kedua",async()=>{
      const entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id}}),before=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-01-01"});await executeJournalCommand(db,admin.id,"REVERSE",{id:entry.id,version:entry.version,date:"2037-01-02",reason:"Koreksi sintetis pembukaan",requestKey:randomUUID()});
      const historical=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-01-01"});assert.deepEqual(historical.balance,before.balance);const after=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});assert.equal(after.balance.totalAssets,"50");assert.equal(after.balance.difference,"0");assert.equal(await db.openingJournal.count(),1);await assert.rejects(previewOpening(db,raw),/sudah pernah/);
    });
  }finally{await isolated.cleanup();}
});
