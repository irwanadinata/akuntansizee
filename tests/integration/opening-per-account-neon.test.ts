import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { loadLocalEnv } from "../../scripts/load-env";
import { isolatedNeon } from "./neon-schema";
import { postOpening, previewOpening } from "../../src/lib/opening/engine";
import { executeJournalCommand, reserve, writeLines, audit } from "../../src/lib/journal/engine";
import { newJournalNumber } from "../../src/lib/journal/identity";
import { financialReport } from "../../src/lib/reports/engine";
import { ledgerReport } from "../../src/lib/ledger/report";
import { openingChoices } from "../../src/lib/opening/queries";
import { createAccountInTransaction } from "../../src/lib/coa/mutations";

loadLocalEnv();
const enabled=process.env.OPENING_TEST_CONFIRM==="CREATE_TEMP_SCHEMA"&&Boolean(process.env.OPENING_TEST_DIRECT_URL||process.env.DIRECT_URL);

for (const single of [true, false]) test(`Neon: pembukaan ${single?"satu":"beberapa"} COA tanpa akun lawan`, {skip:enabled?false:"Butuh database test terisolasi.",timeout:180000}, async t=>{
  const isolated=await isolatedNeon(process.env.OPENING_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
  try {
    const admin=await db.adminUser.create({data:{email:"opening-account@example.invalid",passwordHash:"test-disabled-"+randomUUID()}});
    const fiscal=await db.fiscalYear.create({data:{year:2037,startDate:new Date("2037-01-01"),endDate:new Date("2037-12-31")}});
    const account=async(code:string,name:string,mainType:"ASSET"|"EQUITY",reportGroup:string,normalBalance:"DEBIT"|"CREDIT",isContra=false)=>db.account.create({data:{code,name,mainType,reportGroup,normalBalance,isContra,reviewedAt:new Date()}});
    const bri=await account("1112.1","BRI","ASSET","CASH_BANK","DEBIT"),bca=await account("1112.2","BCA","ASSET","CASH_BANK","DEBIT"),capital=await account("3100.1","Modal","EQUITY","CAPITAL","CREDIT"),contra=await account("1210.1","Akumulasi penyusutan","ASSET","FIXED_ASSET","CREDIT",true);
    const raw={perAccount:true,fiscalYearId:fiscal.id,cutoverDate:"2037-01-01",verificationNote:"",lines:single?[{accountId:bri.id,amount:"10000000"}]:[{accountId:bri.id,amount:"10000000"},{accountId:bca.id,amount:"20000000"}]};
    const counts=async()=>({entries:await db.journalEntry.count(),lines:await db.journalLine.count(),markers:await db.openingJournal.count(),requests:await db.journalRequest.count(),numbers:await db.journalNumber.count(),audits:await db.auditEvent.count()});
    await t.test("preview tidak menulis saldo; hanya COA pilihan yang muncul",async()=>{
      const before=await counts(),preview=await previewOpening(db,raw);
      assert.equal(preview.lines.length,single?1:2);assert.equal(preview.totalCredit,"0");assert.equal(preview.totalDebit,single?"10000000":"30000000");
      assert.ok(preview.lines.every(line=>line.side==="DEBIT"));assert.deepEqual(await counts(),before);
      const credit=await previewOpening(db,{...raw,lines:[{accountId:capital.id,amount:"500"},{accountId:contra.id,amount:"100"}]});
      assert.ok(credit.lines.every(line=>line.side==="CREDIT"));assert.equal(credit.totalDebit,"0");assert.equal(credit.totalCredit,"600");
    });
    await t.test("akun belum disetujui dan konfirmasi kosong ditolak atomik",async()=>{
      const pending=await db.account.create({data:{code:"1199.1",name:"Belum disetujui",mainType:"ASSET",reportGroup:"CURRENT_ASSET",normalBalance:"DEBIT",requiresReview:true,isActive:false}}),before=await counts();
      await assert.rejects(previewOpening(db,{...raw,lines:[{accountId:pending.id,amount:"100"}]}),/nonaktif|disetujui/);
      const p=await previewOpening(db,raw);await assert.rejects(postOpening(db,admin.id,{...p.input,previewHash:p.previewHash,confirmed:false,requestKey:randomUUID()}));
      assert.deepEqual(await counts(),before);
    });
    const preview=await previewOpening(db,raw),payload={...preview.input,previewHash:preview.previewHash,confirmed:true,requestKey:randomUUID()};
    const saved=await postOpening(db,admin.id,payload);
    await t.test("penyimpanan dan retry mencatat persis nominal BRI/BCA tanpa modal",async()=>{
      const entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id},include:{lines:true,openingJournal:true}});
      assert.equal(entry.openingJournal?.perAccount,true);assert.equal(entry.lines.length,single?1:2);
      assert.equal(entry.lines.find(line=>line.accountId===bri.id)?.debit.toFixed(0),"10000000");
      if(!single)assert.equal(entry.lines.find(line=>line.accountId===bca.id)?.debit.toFixed(0),"20000000");
      assert.ok(entry.lines.every(line=>line.credit.toFixed(0)==="0"));assert.ok(!entry.lines.some(line=>line.accountId===capital.id));
      const before=await counts();assert.deepEqual(await postOpening(db,admin.id,payload),saved);
      await assert.rejects(postOpening(db,admin.id,{...payload,requestKey:randomUUID()}),/sudah pernah/);assert.deepEqual(await counts(),before);
    });
    await t.test("buku besar dan laporan membawa saldo tanpa menyembunyikan selisih",async()=>{
      const sameDay=await ledgerReport(db,{accountId:bri.id,from:"2037-01-01",to:"2037-12-31"});assert.equal(sameDay.closing,"10000000");assert.equal(sameDay.rows.length,1);
      const after=await ledgerReport(db,{accountId:bri.id,from:"2037-01-02",to:"2037-12-31"});assert.equal(after.opening,"10000000");
      const report=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});assert.equal(report.balance.totalAssets,single?"10000000":"30000000");assert.equal(report.balance.postedEquity,"0");
      assert.equal(report.balance.difference,report.balance.totalAssets);assert.equal(report.diagnostics.openingDifference,report.balance.totalAssets);assert.equal(report.diagnostics.canUse,false);assert.equal(report.diagnostics.invalidJournals.length,0);
      assert.ok(report.diagnostics.warnings.some(warning=>warning.includes("Saldo pembukaan per COA")));
    });
    await t.test("koreksi satu COA dan penambahan COA tetap diaudit tanpa akun lawan",async()=>{
      let entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id}});
      const input={id:entry.id,version:entry.version,journalNumber:entry.journalNumber,date:"2037-01-01",description:"Koreksi saldo pembukaan per COA",reason:"Sesuai rekening koran",lines:[{accountId:bri.id,debit:"10000000",credit:"0"}],requestKey:randomUUID()};
      await executeJournalCommand(db,admin.id,"UPDATE",input);
      entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id}});
      const expanded={...input,version:entry.version,lines:[...input.lines,{accountId:bca.id,debit:"20000000",credit:"0"}],requestKey:randomUUID()};
      const output=await executeJournalCommand(db,admin.id,"UPDATE",expanded);
      assert.equal(await db.journalLine.count({where:{entryId:saved.id}}),2);assert.equal(await db.auditEvent.count({where:{entityId:saved.id,action:"EDITED"}}),2);
      const before=await counts();
      await assert.rejects(executeJournalCommand(db,admin.id,"UPDATE",{...expanded,version:output.version,date:"2037-01-02",requestKey:randomUUID()}),/cutover/);
      await assert.rejects(executeJournalCommand(db,admin.id,"UPDATE",{...expanded,version:output.version,lines:[{accountId:bri.id,debit:"0",credit:"100"}],requestKey:randomUUID()}),/saldo normal/);
      await assert.rejects(executeJournalCommand(db,admin.id,"UPDATE",{...expanded,version:output.version,lines:[input.lines[0],input.lines[0]],requestKey:randomUUID()}),/neto/);
      assert.deepEqual(await counts(),before);
      const report=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});assert.equal(report.balance.totalAssets,"30000000");
    });
    await t.test("jurnal biasa satu sisi tetap ditolak oleh layanan dan database",async()=>{
      const raw={journalNumber:"JU/UNBALANCED",date:"2037-01-02",description:"Jurnal biasa tidak seimbang",lines:[{accountId:bri.id,debit:"100",credit:"0"}],requestKey:randomUUID()},before=await counts();
      await assert.rejects(executeJournalCommand(db,admin.id,"CREATE",raw));
      const entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id}});
      const balanced=await executeJournalCommand(db,admin.id,"CREATE",{...raw,journalNumber:"JU/BALANCED",lines:[...raw.lines,{accountId:capital.id,debit:"0",credit:"100"}]});
      const afterCreate=await counts();
      await assert.rejects(executeJournalCommand(db,admin.id,"UPDATE",{...raw,id:balanced.id,version:balanced.version,reason:"Uji validasi jurnal biasa",requestKey:randomUUID()}));
      await assert.rejects(db.$transaction(async tx=>{
        const row=await tx.journalEntry.create({data:{journalNumber:await reserve(tx,()=>new Date(),newJournalNumber),date:new Date("2037-01-02"),description:raw.description,fiscalYearId:fiscal.id,createdById:admin.id}});
        await writeLines(tx,row.id,[{accountId:bri.id,debit:"100",credit:"0",description:""},{accountId:bca.id,debit:"200",credit:"0",description:""}]);
        await tx.journalEntry.update({where:{id:row.id},data:{status:"POSTED",postingStatus:"POSTED",postedAt:new Date(),postedById:admin.id,version:{increment:1}}});
        await audit(tx,admin.id,row.id,"POSTED",{});
      }),/seimbang/);
      assert.deepEqual(await counts(),afterCreate);assert.equal(afterCreate.entries,before.entries+1);assert.ok(entry);
    });
    await t.test("saldo normal kredit dan kontra tersimpan; saldo lengkap menghilangkan selisih laporan",async()=>{
      const entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id}});
      await executeJournalCommand(db,admin.id,"UPDATE",{id:entry.id,version:entry.version,journalNumber:entry.journalNumber,date:"2037-01-01",description:"Lengkapi seluruh saldo COA",reason:"Lengkap sesuai bukti saldo awal",requestKey:randomUUID(),lines:[
        {accountId:bri.id,debit:"10000000",credit:"0"},{accountId:bca.id,debit:"20000000",credit:"0"},
        {accountId:contra.id,debit:"0",credit:"1000000"},{accountId:capital.id,debit:"0",credit:"29000000"},
      ]});
      const report=await financialReport(db,{year:2037,from:"2037-01-01",to:"2037-12-31"});
      // The normal transaction above contributes 100 to both cash and capital.
      assert.equal(report.balance.totalAssets,"29000100");assert.equal(report.balance.postedEquity,"29000100");
      assert.equal(report.balance.difference,"0");assert.equal(report.diagnostics.openingDifference,"0");assert.equal(report.diagnostics.canUse,true);
      const ledger=await ledgerReport(db,{accountId:contra.id,from:"2037-01-01",to:"2037-12-31"});assert.equal(ledger.closing,"1000000");assert.equal(ledger.credit,"1000000");
    });
  } finally { await isolated.cleanup(); }
});

test("Neon: dua COA Bank Central Asia buatan admin tampil dan tersimpan tanpa review wajib",{skip:enabled?false:"Butuh database test terisolasi.",timeout:180000},async()=>{
  const isolated=await isolatedNeon(process.env.OPENING_TEST_DIRECT_URL||process.env.DIRECT_URL!),{db}=isolated;
  try{
    const admin=await db.adminUser.create({data:{email:"opening-bca@example.invalid",passwordHash:"test-disabled-"+randomUUID()}});
    const fiscal=await db.fiscalYear.create({data:{year:2037,startDate:new Date("2037-01-01"),endDate:new Date("2037-12-31")}});
    const create=(code:string,name:string,reportGroup:string)=>db.$transaction(tx=>createAccountInTransaction(tx,admin.id,{code,name,description:"",mainType:"ASSET",reportGroup,normalBalance:"DEBIT",isContra:false,isControlAccount:false,isActive:true,requiresReview:false,reviewConfirmed:false,reviewReason:""}));
    const bca1=await create("1112.1","Bank Central Asia 1","CASH_BANK"),bca2=await create("1112.2","Bank Central Asia 2","CURRENT_ASSET");
    assert.equal(bca1.reviewedAt,null);assert.equal(bca2.reviewedAt,null);assert.equal(bca1.requiresReview,false);assert.equal(bca2.requiresReview,false);
    const inactive=await db.account.create({data:{code:"1198.1",name:"Nonaktif",mainType:"ASSET",reportGroup:"CASH_BANK",normalBalance:"DEBIT",isActive:false}});
    const pending=await db.account.create({data:{code:"1198.2",name:"Perlu review",mainType:"ASSET",reportGroup:"CASH_BANK",normalBalance:"DEBIT",requiresReview:true,isActive:false}});
    const control=await db.account.create({data:{code:"1121.1",name:"Piutang Usaha",mainType:"ASSET",reportGroup:"RECEIVABLE",normalBalance:"DEBIT",isControlAccount:true,requiresReview:true,reviewedAt:new Date()}});
    const choices=await openingChoices(db);
    assert.deepEqual(choices.map(account=>account.name),["Bank Central Asia 1","Bank Central Asia 2"]);
    for(const account of [inactive,pending,control])assert.ok(!choices.some(choice=>choice.id===account.id));
    const preview=await previewOpening(db,{perAccount:true,fiscalYearId:fiscal.id,cutoverDate:"2037-01-01",verificationNote:"",lines:[{accountId:bca1.id,amount:"10000000"},{accountId:bca2.id,amount:"20000000"}]});
    const saved=await postOpening(db,admin.id,{...preview.input,previewHash:preview.previewHash,confirmed:true,requestKey:randomUUID()});
    const entry=await db.journalEntry.findUniqueOrThrow({where:{id:saved.id},include:{lines:true}});
    assert.equal(entry.lines.length,2);assert.equal(entry.lines.find(line=>line.accountId===bca1.id)?.debit.toFixed(0),"10000000");assert.equal(entry.lines.find(line=>line.accountId===bca2.id)?.debit.toFixed(0),"20000000");
    await executeJournalCommand(db,admin.id,"UPDATE",{id:entry.id,version:entry.version,journalNumber:entry.journalNumber,date:"2037-01-01",description:"Koreksi saldo BCA",reason:"Rekening koran diperiksa kembali",requestKey:randomUUID(),lines:[{accountId:bca1.id,debit:"11000000",credit:"0"},{accountId:bca2.id,debit:"21000000",credit:"0"}]});
    assert.equal((await ledgerReport(db,{accountId:bca2.id,from:"2037-01-01",to:"2037-12-31"})).closing,"21000000");
    assert.deepEqual((await openingChoices(db)).map(account=>account.id),[bca1.id,bca2.id]);
    assert.equal((await db.account.findUniqueOrThrow({where:{id:bca1.id}})).reviewedAt,null);
    assert.equal((await db.account.findUniqueOrThrow({where:{id:bca2.id}})).reviewedAt,null);
  }finally{await isolated.cleanup();}
});
