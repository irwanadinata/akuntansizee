import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync } from "node:fs";

export async function holdRequest(page, matches) {
  let release, started;
  const gate=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{started=resolve;});let count=0;
  const handler=async route=>{if(matches(route.request())){count++;started();await gate;}try{await route.continue();}catch{/* Request may have been cancelled by the user. */}};
  await page.route("**/*",handler);
  return{count:()=>count,release,started:async()=>{let timer;try{await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error("Expected request did not start")),15000);})]);}finally{clearTimeout(timer);}},stop:async()=>{release();await page.unroute("**/*",handler);}};
}

export async function checkLoading({page,db,origin,screenshots,directory,pass}){
  const getPath=request=>new URL(request.url()).pathname;
  await page.goto(origin+"/jurnal?year=2037&fresh=loading");await page.waitForLoadState("networkidle");
  let gate=await holdRequest(page,request=>request.method()==="GET"&&getPath(request)==="/piutang-customer"&&!request.headers()["next-router-prefetch"]);
  try{await page.locator('aside a[href^="/piutang-customer"]').click();await gate.started();await page.waitForFunction(()=>Boolean(document.querySelector("[data-navigation-loading],[data-page-loading]")));await page.screenshot({path:join(screenshots,"loading-navigation.png"),caret:"initial"});gate.release();await page.waitForURL(url=>url.pathname==="/piutang-customer");await page.locator("main h1").waitFor();await page.waitForFunction(()=>!document.querySelector("[data-navigation-loading],[data-page-loading]"));}finally{await gate.stop();}
  pass("navigation shows real transition/loading UI and clears when content arrives");

  const routes=["/pinjaman-karyawan","/piutang-customer","/utang-supplier","/jurnal","/coa","/buku-besar","/neraca","/laba-rugi","/laporan-keuangan"];
  for(const [index,path]of routes.entries()){
    await page.goto(origin+path+"?year=2037");await page.waitForLoadState("networkidle");const form=page.locator("[data-filter-bar]");
    if(path==="/buku-besar"){await form.locator('button[type=submit]').click();assert.equal(await form.locator("[data-filter-pending]").count(),0);await form.locator("#accountId").selectOption({index:1});}
    else if(await form.locator("#q").count())await form.locator("#q").fill("loading-"+index);
    else await form.locator("#hideZero").selectOption("false");
    const width=(await form.locator('button[type=submit]').boundingBox()).width;
    gate=await holdRequest(page,request=>request.method()==="GET"&&getPath(request)===path&&!request.headers()["next-router-prefetch"]);
    try{
      await form.locator('button[type=submit]').click();await gate.started();await page.waitForFunction(()=>Boolean(document.querySelector("[data-filter-pending],[data-page-loading]")));
      if(await form.locator("[data-filter-pending]").count()){
        assert.ok(await form.locator('button[type=submit]').isDisabled());assert.ok(await form.locator("input:not([type=hidden]),select").first().isDisabled());
        assert.ok(Math.abs((await form.locator('button[type=submit]').boundingBox()).width-width)<2,"Filter button width remains stable");
        await form.locator('button[type=submit]').evaluate(button=>button.click());assert.equal(gate.count(),1);
      }
      if(path==="/neraca")await page.screenshot({path:join(screenshots,"loading-filter.png"),caret:"initial"});
      gate.release();await page.waitForFunction(()=>!document.querySelector("[data-filter-pending],[data-page-loading]"));assert.ok(!(await page.locator('[data-filter-bar] button[type=submit]').isDisabled()));assert.equal(new URL(page.url()).searchParams.get("year"),"2037");
    }finally{await gate.stop();}
  }
  pass("nine filter pages show pending feedback, block repeat submits and restore controls with year retained");

  await page.goto(origin+"/jurnal?year=2037&q=loading-reset");await page.waitForLoadState("networkidle");
  gate=await holdRequest(page,request=>request.method()==="GET"&&getPath(request)==="/jurnal"&&!new URL(request.url()).searchParams.has("q")&&!request.headers()["next-router-prefetch"]);
  try{await page.getByRole("link",{name:"Reset",exact:true}).click();await gate.started();await page.waitForFunction(()=>Boolean(document.querySelector("[data-navigation-loading],[data-page-loading]")));gate.release();await page.waitForFunction(()=>!document.querySelector("[data-navigation-loading],[data-page-loading]"));assert.equal(new URL(page.url()).searchParams.get("year"),"2037");assert.equal(new URL(page.url()).searchParams.has("q"),false);}finally{await gate.stop();}
  assert.equal(await page.locator('[data-filter-bar] #q').inputValue(),"");
  pass("reset filter has navigation feedback, clears input and preserves selected year");
  gate=await holdRequest(page,request=>request.method()==="POST"&&getPath(request)==="/jurnal");
  try{await page.getByLabel("Tahun buku aktif").selectOption("all");await gate.started();assert.ok(await page.getByLabel("Tahun buku aktif").isDisabled());assert.ok((await page.locator("#active-year-status").textContent()).includes("Memuat"));gate.release();await page.waitForURL(url=>url.searchParams.get("year")==="all");await page.waitForFunction(()=>!document.querySelector("#active-fiscal-year")?.disabled);}finally{await gate.stop();}
  pass("fiscal year selector shows loading until the authenticated update finishes");

  await page.goto(origin+"/coa?year=2037");await page.waitForLoadState("networkidle");const panel=page.locator("[data-creation-panel]");
  gate=await holdRequest(page,request=>request.method()==="POST"&&getPath(request)==="/coa");
  try{await page.getByRole("link",{name:"Tambah akun",exact:true}).click();await gate.started();await panel.getByRole("status").filter({hasText:"Menyiapkan formulir"}).waitFor();assert.equal(await page.locator("[data-navigation-loading]").count(),0);await panel.getByRole("button",{name:"Tutup formulir",exact:true}).click();gate.release();await page.waitForLoadState("networkidle");assert.equal(await panel.getAttribute("open"),null);}finally{await gate.stop();}
  pass("panel loading is scoped to the panel and late responses cannot reopen it");
  await page.getByRole("link",{name:"Tambah akun",exact:true}).click();await panel.locator("#code").waitFor();await panel.locator("#code").fill("1199.98");await panel.locator("#name").fill("Akun Loading QA");
  gate=await holdRequest(page,request=>request.method()==="POST"&&getPath(request)==="/coa");
  try{await panel.getByRole("button",{name:"Simpan akun",exact:true}).dblclick();await gate.started();assert.ok(await panel.locator('button[data-loading="true"]').isDisabled());await page.waitForFunction(()=>document.querySelector('[data-creation-panel] button[aria-label="Tutup formulir"]')?.disabled);await page.screenshot({path:join(screenshots,"loading-save.png"),caret:"initial"});gate.release();await panel.getByRole("button",{name:"Selesai",exact:true}).click();await panel.waitFor({state:"hidden"});assert.equal(await db.account.count({where:{code:"1199.98"}}),1);}finally{await gate.stop();}
  pass("save buttons show spinner and busy state, prevent duplicate writes and recover");
  await page.getByRole("link",{name:"Tambah akun",exact:true}).click();await panel.locator("#code").fill("1199.98");await panel.locator("#name").fill("Duplikat Loading QA");await panel.getByRole("button",{name:"Simpan akun",exact:true}).click();await panel.getByRole("status").filter({hasText:"Kode akun sudah digunakan"}).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-creation-panel] button[type="submit"]')?.disabled);await panel.getByRole("button",{name:"Tutup formulir",exact:true}).click();await panel.getByRole("button",{name:"Tutup & buang isian",exact:true}).click();
  pass("validation/server failures clear saving state and allow correction or dismissal");

  await page.goto(origin+"/neraca?year=2037");await page.waitForLoadState("networkidle");const download=page.locator("[data-pdf-download]");
  gate=await holdRequest(page,request=>getPath(request)==="/laporan-keuangan/pdf");
  try{await download.getByRole("button",{name:"Unduh PDF",exact:true}).click();await gate.started();assert.ok(await download.locator('button[data-loading="true"]').isDisabled());await download.getByRole("button",{name:"Batalkan unduhan",exact:true}).waitFor();await page.screenshot({path:join(screenshots,"loading-pdf.png"),caret:"initial"});const event=page.waitForEvent("download");gate.release();const file=await event;const path=join(directory,"loading-report.pdf");await file.saveAs(path);assert.equal(readFileSync(path).subarray(0,4).toString(),"%PDF");await download.getByRole("button",{name:"Unduh PDF",exact:true}).waitFor();}finally{await gate.stop();}
  pass("PDF preparation stays busy until real PDF bytes are ready and downloads successfully");
  const pdf="**/laporan-keuangan/pdf?*";const fail=route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"PDF uji belum siap."})});await page.route(pdf,fail);
  try{await download.getByRole("button",{name:"Unduh PDF",exact:true}).click();await download.getByRole("status").filter({hasText:"PDF uji belum siap"}).waitFor();assert.ok(!(await download.getByRole("button",{name:"Unduh PDF",exact:true}).isDisabled()));}finally{await page.unroute(pdf,fail);}
  pass("PDF errors are visible and restore the download button for retry");
  gate=await holdRequest(page,request=>getPath(request)==="/laporan-keuangan/pdf");
  try{await download.getByRole("button",{name:"Unduh PDF",exact:true}).click();await gate.started();await download.getByRole("button",{name:"Batalkan unduhan",exact:true}).click();await download.getByRole("status").filter({hasText:"Unduhan dibatalkan"}).waitFor();assert.ok(!(await download.getByRole("button",{name:"Unduh PDF",exact:true}).isDisabled()));}finally{await gate.stop();}
  pass("PDF download can be cancelled without leaving a stuck loading state");
  assert.equal(await db.journalEntry.count(),0);assert.equal(await db.journalLine.count(),0);
}
