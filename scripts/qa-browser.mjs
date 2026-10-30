// Development/test only. Copies source to an ignored directory, keeps auth and
// business logic intact, and redirects ONLY the copied DB adapter to a fresh
// isolated Neon schema. Never edits env files or seeds the application schema.
import assert from "node:assert/strict";
import { cpSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,existsSync } from "node:fs";
import { resolve,join } from "node:path";
import { createRequire } from "node:module";
import { randomBytes,randomUUID } from "node:crypto";
import { spawn,execFileSync } from "node:child_process";
import { loadLocalEnv } from "./load-env.ts";
import { isolatedNeon } from "../tests/integration/neon-schema.ts";
import { buildSeedPlan } from "../src/lib/coa/seed-plan.ts";
import { hashPassword } from "../src/lib/auth/password.ts";
import { hashSessionToken } from "../src/lib/auth/token.ts";
import { checkCreationPanels, checkCoaPanel } from "./qa-creation-panels.mjs";
import { checkNavigation } from "./qa-navigation.mjs";
import { checkLoading, holdRequest } from "./qa-loading.mjs";
loadLocalEnv();
assert.equal(process.env.UI_QA_CONFIRM,"CREATE_TEMP_SCHEMA","Set UI_QA_CONFIRM=CREATE_TEMP_SCHEMA for an authorized Neon development/test target.");
const require=createRequire(import.meta.url),{chromium}=require(process.env.QA_PLAYWRIGHT_PATH||"playwright");
const root=process.cwd(),directory=resolve(".npm-cache/final-ui-"+randomUUID()),origin="http://127.0.0.1:3107";
assert.ok(directory.startsWith(resolve(root,".npm-cache")+"\\")||directory.startsWith(resolve(root,".npm-cache")+"/"));
const isolated=await isolatedNeon(process.env.UI_QA_DIRECT_URL||process.env.DIRECT_URL),{db,schema}=isolated;
const password=randomBytes(24).toString("base64url")+"aA1!",secret=randomBytes(48).toString("base64url"),email="ui-qa@example.invalid";
let child,browser,logs="";const checks=[];
const pass=item=>{Array.prototype.push.call(checks,item);console.info("PASS UI: "+item);};
const redact=text=>[password,secret,process.env.DATABASE_URL,process.env.DIRECT_URL].filter(Boolean).reduce((value,item)=>value.split(item).join("[REDACTED]"),String(text)).replace(/ep-[a-z0-9.-]+\.neon\.tech/gi,"[NEON_HOST]");
try{
  await db.adminUser.create({data:{email,passwordHash:await hashPassword(password)}});
  const plan=buildSeedPlan(readFileSync("prisma/coa-source.json","utf8"),JSON.parse(readFileSync("prisma/coa-code-decisions.json","utf8")));await db.account.createMany({data:plan});
  const fiscal=await db.fiscalYear.create({data:{year:2037,startDate:new Date("2037-01-01T00:00:00Z"),endDate:new Date("2037-12-31T00:00:00Z")}});
  for(const name of["src","assets","prisma","scripts"])cpSync(join(root,name),join(directory,name),{recursive:true});
  for(const name of["next.config.ts","tsconfig.json","next-env.d.ts","postcss.config.mjs","package.json"])cpSync(join(root,name),join(directory,name));
  symlinkSync(join(root,"node_modules"),join(directory,"node_modules"),"junction");
  // This test-only adapter replacement is confined to the disposable source copy.
  writeFileSync(join(directory,"src/lib/db-core.ts"),`import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient,type Prisma } from "../generated/prisma/client";
import { getRuntimeDatabaseEnv } from "./env/validation";
const state=globalThis as unknown as {qaDb?:PrismaClient};
export function getPrisma():PrismaClient{
 if(!state.qaDb){const actual=new PrismaClient({adapter:new PrismaNeon({connectionString:getRuntimeDatabaseEnv().DATABASE_URL},{schema:${JSON.stringify(schema)}}),log:[],errorFormat:"minimal"});
 const transaction=<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>,options?:object)=>actual.$transaction(async tx=>{await tx.$executeRawUnsafe(${JSON.stringify('SET LOCAL search_path TO "'+schema+'"')});return work(tx);},{maxWait:10000,timeout:30000,...options});
 state.qaDb=new Proxy(actual,{get(target,key){if(key==="$transaction")return transaction;if(["$queryRaw","$queryRawUnsafe","$executeRaw","$executeRawUnsafe"].includes(String(key)))return(...args:unknown[])=>transaction(tx=>Reflect.apply(Reflect.get(tx,key),tx,args));const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});}
 return state.qaDb;
}
export function createDirectPrismaClient():never{throw new Error("Administrative clients are disabled in the isolated UI QA copy.");}
`);
  child=spawn(process.execPath,[join(root,"node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port","3107"],{cwd:directory,env:{...process.env,NODE_ENV:"development",AUTH_SECRET:secret,APP_ORIGIN:origin,NEXT_TELEMETRY_DISABLED:"1"},windowsHide:true,stdio:["ignore","pipe","pipe"]});
  child.stdout.on("data",chunk=>{logs=(logs+chunk.toString()).slice(-18000);});child.stderr.on("data",chunk=>{logs=(logs+chunk.toString()).slice(-18000);});
  let ready=false;for(let attempt=0;attempt<45;attempt++){try{const response=await fetch(origin+"/login",{signal:AbortSignal.timeout(5000)});if(response.status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  assert.ok(ready,"QA server must start");
  browser=await chromium.launch({channel:existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe")?"chrome":"msedge",headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(45000);
  const scriptReads=[];page.on("response",response=>{if(response.url().includes("/_next/static/")&&response.url().includes(".js"))scriptReads.push(response.text().catch(()=>""));});
  let loginRequest;page.on("request",request=>{if(!loginRequest&&request.method()==="POST"&&request.headers()["next-action"])loginRequest={headers:request.headers(),body:request.postData()};});
  await page.goto(origin+"/pinjaman-karyawan");assert.equal(new URL(page.url()).pathname,"/login");pass("anonymous pages redirect");
  await page.getByLabel("Email admin").fill(email);await page.getByLabel("Kata sandi",{exact:true}).fill(password);
  if(process.env.UI_QA_LOADING_ONLY==="1"){
    const gate=await holdRequest(page,request=>request.method()==="POST"&&new URL(request.url()).pathname==="/login");
    try{await page.getByRole("button",{name:"Masuk ke aplikasi",exact:true}).click();await gate.started();assert.ok(await page.locator('button[aria-busy="true"]').isDisabled());assert.ok(await page.getByLabel("Kata sandi",{exact:true}).isDisabled());gate.release();await page.waitForURL(url=>url.pathname==="/");pass("login displays actual pending state and disables duplicate submission");}finally{await gate.stop();}
  }else{await page.getByRole("button",{name:"Masuk ke aplikasi",exact:true}).click();await page.waitForURL(url=>url.pathname==="/");}
  assert.equal(await db.adminSession.count(),1);const cookies=await context.cookies();assert.ok(cookies.some(cookie=>cookie.name==="zee_session"&&cookie.httpOnly&&cookie.sameSite==="Lax"));pass("real login creates hashed HttpOnly session");
  const screenshots=join(directory,"screenshots");mkdirSync(screenshots,{recursive:true});
  if(process.env.UI_QA_LOADING_ONLY==="1"){
    await checkLoading({page,db,origin,screenshots,directory,pass});
  }else if(process.env.UI_QA_COA_PANEL_ONLY==="1"){
    await checkCoaPanel({page,db,origin,screenshots,pass});
  }else if(process.env.UI_QA_NAVIGATION_ONLY==="1"){
    await checkNavigation({page,db,origin,screenshots,directory,pass});
  }else if(process.env.UI_QA_PANELS_ONLY==="1"){
    await checkCreationPanels({page,db,origin,screenshots,pass});
  }else{
  if(process.env.UI_QA_LAYOUT_ONLY!=="1"){
  await page.goto(origin+"/pinjaman-karyawan/baru?year=2037");await page.waitForFunction(()=>Boolean(document.querySelector("#date")?.value));
  await page.getByLabel("Nama karyawan").fill("Karyawan QA sintetis");const amount=page.locator("#amount");await amount.pressSequentially("1000");assert.equal(await amount.inputValue(),"1.000");await amount.evaluate(element=>element.setSelectionRange(1,1));await amount.press("2");assert.equal(await amount.inputValue(),"12.000");assert.equal(await amount.evaluate(element=>element.selectionStart),2);pass("Rupiah typing and middle caret");
  await amount.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await amount.fill("2000000");assert.equal(await amount.inputValue(),"2.000.000");await page.locator("#cashAccountId").selectOption({index:1});await page.getByRole("button",{name:"Periksa & lanjutkan"}).click();await page.getByRole("button",{name:"Simpan & Catat"}).dblclick();await page.getByText("Transaksi dan jurnal otomatis sudah tersimpan bersama.").waitFor();
  assert.equal(await db.loan.count(),1);assert.equal(await db.journalEntry.count({where:{postingStatus:"POSTED"}}),1);pass("double-click creates one loan/journal");
  const loan=await db.loan.findFirstOrThrow();
  for(const value of["500000","250000"]){await page.goto(origin+"/pinjaman-karyawan/"+loan.id+"/cicilan/baru?year=2037");await page.waitForFunction(()=>Boolean(document.querySelector("#date")?.value));await page.locator("#amount").fill(value);await page.locator("#cashAccountId").selectOption({index:1});await page.getByRole("button",{name:"Periksa & lanjutkan"}).click();await page.getByRole("button",{name:"Simpan & Catat"}).click();await page.getByText("Transaksi dan jurnal otomatis sudah tersimpan bersama.").waitFor();}
  await page.goto(origin+"/pinjaman-karyawan/"+loan.id+"?year=2037");assert.ok((await page.textContent("main")).includes("Rp 1.250.000"));pass("loan repayments and remaining balance");
  await page.screenshot({path:join(screenshots,"desktop-loan.png"),fullPage:true,caret:"initial"});
  for(const [kind,path,party,amount,payment,remaining]of[["RECEIVABLE","/piutang-customer","Customer QA sintetis","5000000","2000000","Rp 3.000.000"],["PAYABLE","/utang-supplier","Supplier QA sintetis","4000000","1500000","Rp 2.500.000"]]){
    await page.goto(origin+path+"/baru?year=2037");await page.waitForFunction(()=>Boolean(document.querySelector("#date")?.value));await page.locator("#partyName").fill(party);await page.locator("#amount").fill(amount);await page.locator("#counterAccountId").selectOption({index:1});await page.getByRole("button",{name:"Periksa & lanjutkan"}).click();await page.getByRole("button",{name:"Simpan & Catat"}).click();await page.getByText("Tagihan dan jurnal otomatis sudah dicatat.",{exact:false}).waitFor();
    const doc=await db.tradeDocument.findFirstOrThrow({where:{kind,partyName:party}});await page.goto(origin+path+"/"+doc.id+"/pembayaran/baru?year=2037");await page.waitForFunction(()=>Boolean(document.querySelector("#date")?.value));await page.locator("#amount").fill(payment);await page.locator("#cashAccountId").selectOption({index:1});await page.getByRole("button",{name:"Periksa & lanjutkan"}).click();await page.getByRole("button",{name:"Simpan & Catat"}).click();await page.getByText("Pembayaran dan jurnal otomatis sudah dicatat bersama.").waitFor();await page.goto(origin+path+"/"+doc.id+"?year=2037");assert.ok((await page.textContent("main")).includes(remaining));pass(kind+" invoice/payment UI and outstanding");
  }
  await page.goto(origin+"/coa?year=2037");const cashName=plan.find(account=>account.reportGroup==="CASH_BANK").name;await page.locator("#q").fill(cashName);await page.locator("#review").selectOption("reviewed");await page.getByRole("button",{name:"Terapkan",exact:true}).click();await page.waitForURL(url=>url.searchParams.get("q")===cashName);assert.equal(new URL(page.url()).searchParams.get("year"),"2037");await page.getByRole("link",{name:cashName,exact:true}).waitFor();pass("approved ordinary COA remains visible and filter preserves year");
  await page.goto(origin+"/neraca?year=2037&from=2037-01-01&to=2037-12-31");await page.getByText("Neraca seimbang, debit/kredit cocok",{exact:false}).waitFor();const journalNumbers=(await db.journalEntry.findMany()).map(entry=>entry.journalNumber);
  const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:"Unduh PDF",exact:true}).click()]);await download.saveAs(join(directory,"synthetic-balance.pdf"));assert.equal(await db.journalEntry.count(),journalNumbers.length);assert.deepEqual((await db.journalEntry.findMany()).map(entry=>entry.journalNumber),journalNumbers);pass("reports and PDF preserve stored journal numbers");
  const printed=await page.pdf({path:join(directory,"synthetic-browser-print.pdf"),format:"A4",printBackground:true});assert.equal(printed.subarray(0,4).toString(),"%PDF");pass("browser print CSS renders an A4 PDF");
  for(const route of["/neraca?year=2037","/piutang-customer/baru?year=2037","/utang-supplier/baru?year=2037","/pinjaman-karyawan/baru?year=2037"]){await page.setViewportSize({width:390,height:844});await page.goto(origin+route);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),"No page-level horizontal overflow: "+route);await page.screenshot({path:join(screenshots,route.split("?")[0].replaceAll("/","-")+"-mobile.png"),fullPage:true,caret:"initial"});}pass("390px responsive forms and balance report");
  }
  const cashAccount=plan.find(account=>account.reportGroup==="CASH_BANK"),cash=await db.account.findUniqueOrThrow({where:{code:cashAccount.code}}),responsiveChecks=[];
  const filterRoutes=["/pinjaman-karyawan","/piutang-customer","/utang-supplier","/jurnal","/coa","/buku-besar","/neraca","/laba-rugi","/laporan-keuangan"];
  for(const width of[320,390,768,1024,1280,1440,1920]){
    await page.setViewportSize({width,height:width<768?844:1000});
    for(const route of filterRoutes){
      await page.goto(origin+route+"?year=2037"+(route==="/buku-besar"?"&accountId="+cash.id:""));
      await page.locator("[data-filter-bar]").waitFor();
      const layout=await page.evaluate(()=>{
        const form=document.querySelector("[data-filter-bar]"),bounds=form.getBoundingClientRect(),parent=form.parentElement.getBoundingClientRect(),fields=form.querySelector(".filter-bar-fields"),controls=[...fields.querySelectorAll("input:not([type=hidden]),select")];
        const within=(child,area)=>child.left>=area.left-1&&child.right<=area.right+1;
        const buttons=[...form.querySelectorAll(".filter-bar-actions [data-slot=button]")],lastInput=controls.at(-1).getBoundingClientRect(),columns=getComputedStyle(fields).gridTemplateColumns.split(" ").length;
        const actionsAligned=buttons.every(button=>{const box=button.getBoundingClientRect();return Math.abs(box.top-lastInput.top)<2&&Math.abs(box.bottom-lastInput.bottom)<2;});
        const allInOneRow=controls.every(control=>Math.abs(control.getBoundingClientRect().bottom-lastInput.bottom)<2)&&actionsAligned;
        return{overflow:document.documentElement.scrollWidth>innerWidth+1,fullWidth:Math.abs(bounds.width-parent.width)<2,controlsFit:controls.every(control=>{const box=control.getBoundingClientRect(),field=control.parentElement.getBoundingClientRect();return within(box,bounds)&&within(box,field)&&Math.abs(box.width-field.width)<2&&box.height>=43;}),actionsFit:buttons.every(button=>within(button.getBoundingClientRect(),bounds)),actionsInlineExpected:columns>1,actionsAligned,allInOneRow,columns,formWidth:Math.round(bounds.width)};
      });
      assert.equal(layout.overflow,false,`${width}px ${route}: page must not overflow`);assert.ok(layout.fullWidth,`${width}px ${route}: filter must fill content width`);assert.ok(layout.controlsFit&&layout.actionsFit,`${width}px ${route}: fields and actions must fit their panel`);
      if(layout.actionsInlineExpected)assert.ok(layout.actionsAligned,`${width}px ${route}: actions align with last input`);
      if(layout.columns>=4)assert.ok(layout.allInOneRow,`${width}px ${route}: wide filters fit a single row`);
      responsiveChecks.push({width,route,...layout});
      if(route==="/jurnal")await page.screenshot({path:join(screenshots,`filters-${width}.png`),caret:"initial"});
      if(route==="/coa"&&width===1280)await page.screenshot({path:join(screenshots,"coa-filters-desktop.png"),caret:"initial"});
      if(route==="/neraca"&&[390,1024,1440].includes(width))await page.screenshot({path:join(screenshots,`report-filters-${width}.png`),caret:"initial"});
    }
  }
  writeFileSync(join(directory,"responsive-result.json"),JSON.stringify(responsiveChecks,null,2));pass("full-width filters and header at 7 widths across 9 pages (63 layouts)");
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+"/pinjaman-karyawan/baru?year=2037");assert.ok((await page.getByRole("navigation",{name:"Lokasi halaman"}).innerText()).includes("Pinjaman Karyawan"));assert.equal(await page.locator("aside a[aria-current=page]").innerText(),"Pinjaman Karyawan");pass("nested pages retain correct sidebar and navbar context");
  await page.setViewportSize({width:390,height:844});await page.goto(origin+"/jurnal?year=2037");await page.waitForLoadState("networkidle");const menu=page.getByRole("button",{name:"Buka menu utama",exact:true});await menu.click();const drawer=page.getByRole("dialog",{name:"Navigasi utama"});await drawer.waitFor();await page.screenshot({path:join(screenshots,"mobile-sidebar.png"),caret:"initial"});
  await page.keyboard.press("Shift+Tab");assert.ok(await drawer.evaluate(element=>element.contains(document.activeElement)),"Native modal contains keyboard focus");await page.keyboard.press("Escape");await drawer.waitFor({state:"hidden"});await menu.evaluate(element=>{if(document.activeElement!==element)throw new Error("Focus returns to menu trigger");});
  await menu.click();await drawer.getByRole("link",{name:"Neraca",exact:true}).click();await page.waitForURL(url=>url.pathname==="/neraca");assert.equal(new URL(page.url()).searchParams.get("year"),"2037");await drawer.waitFor({state:"hidden"});await menu.click();await page.mouse.click(380,400);await drawer.waitFor({state:"hidden"});pass("mobile drawer supports keyboard, Escape, backdrop, navigation and preserved year");
  await page.goto(origin+"/jurnal?year=2037");await page.waitForLoadState("networkidle");await page.getByLabel("Tahun buku aktif").selectOption("all");await page.waitForURL(url=>url.searchParams.get("year")==="all");assert.equal(await page.getByLabel("Tahun buku aktif").inputValue(),"all");await page.getByLabel("Tahun buku aktif").selectOption("2037");await page.waitForURL(url=>url.searchParams.get("year")==="2037");pass("navbar year selection persists via authenticated server action");
  await page.goto(origin+"/jurnal?year=2037");await page.locator("#q").fill("Pinjaman");await page.locator("#status").selectOption("POSTED");await page.getByRole("button",{name:"Terapkan",exact:true}).click();await page.waitForURL(url=>url.searchParams.get("q")==="Pinjaman");assert.equal(new URL(page.url()).searchParams.get("status"),"POSTED");assert.equal(new URL(page.url()).searchParams.get("year"),"2037");await page.getByRole("link",{name:"Reset",exact:true}).click();await page.waitForURL(url=>url.pathname==="/jurnal"&&!url.searchParams.has("q"));assert.equal(new URL(page.url()).searchParams.get("year"),"2037");pass("journal filter and reset preserve selected fiscal year");
  }
  const before=await db.adminSession.count();assert.ok(loginRequest);const response=await context.request.post(origin+"/login",{headers:{"Next-Action":loginRequest.headers["next-action"],"Content-Type":loginRequest.headers["content-type"],Origin:"https://untrusted.invalid"},data:loginRequest.body});await response.dispose();assert.equal(await db.adminSession.count(),before);pass("untrusted Origin cannot create session");
  const privateValues=[password,secret,process.env.DATABASE_URL,process.env.DIRECT_URL,new URL(process.env.DATABASE_URL).hostname,...cookies.map(cookie=>cookie.value)];
  const clientText=(await page.content())+(await Promise.all(scriptReads)).join("\n");assert.ok(privateValues.every(value=>!clientText.includes(value)),"No private env values in HTML/client chunks");pass("no Neon URL, host or auth secret in client responses");
  if(process.env.UI_QA_LOADING_ONLY==="1"){
    const gate=await holdRequest(page,request=>request.method()==="POST");
    try{await page.getByRole("button",{name:"Keluar",exact:true}).click();await gate.started();assert.ok(await page.locator('header button[aria-busy="true"]').isDisabled());gate.release();await page.waitForURL(url=>url.pathname==="/login");pass("logout shows pending state until server session is revoked");}finally{await gate.stop();}
  }else{await page.getByRole("button",{name:"Keluar",exact:true}).click();await page.waitForURL(url=>url.pathname==="/login");}
  assert.equal(await db.adminSession.count(),0);const replay=await browser.newContext();await replay.addCookies(cookies);const replayPage=await replay.newPage();await replayPage.goto(origin+"/jurnal");assert.equal(new URL(replayPage.url()).pathname,"/login");await replay.close();pass("logout revokes server session and cookie replay fails");
  const token=cookies.find(cookie=>cookie.name==="zee_session").value,admin=await db.adminUser.findFirstOrThrow();await db.adminSession.create({data:{adminId:admin.id,tokenHash:hashSessionToken(token,secret),createdAt:new Date(Date.now()-7200000),expiresAt:new Date(Date.now()-3600000)}});
  const expired=await browser.newContext();await expired.addCookies(cookies);const expiredPage=await expired.newPage();await expiredPage.goto(origin+"/jurnal");assert.equal(new URL(expiredPage.url()).pathname,"/login");await expired.addCookies(cookies.map(cookie=>({...cookie,value:randomBytes(32).toString("base64url")})));await expiredPage.goto(origin+"/neraca");assert.equal(new URL(expiredPage.url()).pathname,"/login");await expired.close();await db.adminSession.deleteMany();pass("expired and forged session cookies fail closed");
  for(let attempt=0;attempt<6;attempt++){const result=await context.request.post(origin+"/login",{headers:{"Next-Action":loginRequest.headers["next-action"],"Content-Type":loginRequest.headers["content-type"],Origin:origin},data:loginRequest.body.replaceAll(password,"WrongQaPassword1!")});await result.dispose();}
  const throttle=await db.loginThrottle.findFirstOrThrow();assert.equal(throttle.attempts,6);assert.ok(throttle.blockedUntil>new Date());assert.equal(await db.adminSession.count(),0);pass("sixth login attempt is blocked by persistent DB throttle");
  assert.ok(!logs.includes(password)&&!logs.includes(secret)&&!logs.includes(process.env.DATABASE_URL)&&!logs.includes(process.env.DIRECT_URL),"No credentials or auth secret may appear in framework logs");pass("framework Server Function logs do not disclose credentials");
  assert.equal((await db.fiscalYear.findUniqueOrThrow({where:{id:fiscal.id}})).status,"OPEN");
  writeFileSync(join(directory,"result.json"),JSON.stringify({checks,navigationOnly:process.env.UI_QA_NAVIGATION_ONLY==="1",panelsOnly:process.env.UI_QA_PANELS_ONLY==="1",layoutOnly:process.env.UI_QA_LAYOUT_ONLY==="1",isolatedSchema:true,adapterOverride:"test-copy-only",applicationSchemaModified:false},null,2));console.info(JSON.stringify({passed:checks.length,checks,artifacts:directory,applicationSchemaModified:false}));
}catch(error){if(browser){try{const failed=browser.contexts()[0]?.pages()[0];if(failed)await failed.screenshot({path:join(directory,"failure.png"),fullPage:true,caret:"initial"});}catch{}}console.error(redact(error.stack));console.error(redact(logs.slice(-7000)));process.exitCode=1;}
finally{
  if(browser)await browser.close();
  if(child?.pid){try{if(process.platform==="win32")execFileSync("taskkill",["/PID",String(child.pid),"/T","/F"],{stdio:"ignore",windowsHide:true});else child.kill("SIGTERM");}catch{}}
  await isolated.cleanup();
}
