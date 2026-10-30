import assert from "node:assert/strict";
import { join } from "node:path";

const cases = [
  { kind: "loan", path: "/pinjaman-karyawan", title: "Catat Pinjaman", trigger: /Catat Pinjaman/, field: "employeeName", name: "Karyawan Panel QA", amount: "2000000", choice: "cashAccountId", prefix: "PJM" },
  { kind: "receivable", path: "/piutang-customer", title: "Buat Tagihan Customer", trigger: /Buat Tagihan Customer/, field: "partyName", name: "Customer Panel QA", amount: "5000000", choice: "counterAccountId", prefix: "PIU" },
  { kind: "payable", path: "/utang-supplier", title: "Catat Tagihan Supplier", trigger: /Catat Tagihan Supplier/, field: "partyName", name: "Supplier Panel QA", amount: "4000000", choice: "counterAccountId", prefix: "UTG" },
];

export async function checkCoaPanel({page, db, origin, screenshots, pass}) {
  const panel=page.locator('[data-creation-panel]'), code='1199.99', name='Akun Panel COA QA';
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(origin+'/coa?year=2037&q=Panel+COA+QA&type=ASSET&status=active&review=all');await page.waitForLoadState('networkidle');
  const url=page.url();
  const open=async()=>{await page.getByRole('link',{name:'Tambah akun',exact:true}).click();await panel.waitFor({state:'visible'});await panel.locator('#code').waitFor();await page.waitForFunction(()=>document.querySelector('[data-creation-panel] #mainType')?.value==='ASSET');};
  await open();assert.equal(page.url(),url);assert.equal(await page.locator('main h1').innerText(),'Daftar Akun (COA)');
  const box=await panel.boundingBox();assert.ok(box.x>0&&Math.abs(box.x+box.width-1440)<2);
  await panel.getByRole('button',{name:'Simpan akun',exact:true}).click();assert.ok((await panel.getByRole('alert').allTextContents()).some(text=>text.trim()));
  await panel.locator('#code').fill(code);await panel.locator('#name').fill(name);await panel.getByLabel('Saya sudah memeriksa',{exact:false}).check();
  await page.screenshot({path:join(screenshots,'coa-panel-desktop.png'),caret:'initial'});
  await panel.getByRole('button',{name:'Tutup formulir',exact:true}).click();await panel.getByRole('button',{name:'Lanjutkan mengisi',exact:true}).click();assert.equal(await panel.locator('#code').inputValue(),code);
  pass('COA opens from right above unchanged list, validates and preserves unsaved input');
  await panel.getByRole('button',{name:'Simpan akun',exact:true}).dblclick();await panel.getByRole('button',{name:'Selesai',exact:true}).waitFor();
  const account=await db.account.findUniqueOrThrow({where:{code}});assert.equal(account.name,name);assert.equal(await db.account.count(),92);
  await panel.getByRole('button',{name:'Selesai',exact:true}).click();await panel.waitFor({state:'hidden'});await page.getByRole('link',{name,exact:true}).waitFor();
  assert.equal(page.url(),url);assert.equal(await page.locator('#q').inputValue(),'Panel COA QA');assert.equal(new URL(page.url()).searchParams.get('year'),'2037');
  pass('COA save creates exactly one account, refreshes list and retains filters/year');
  await open();assert.equal(await panel.locator('#code').inputValue(),'');await panel.locator('#code').fill(code);await panel.locator('#name').fill('Nama tidak boleh menimpa');await panel.getByRole('button',{name:'Simpan akun',exact:true}).click();await panel.getByRole('status').filter({hasText:'Kode akun sudah digunakan'}).waitFor();
  assert.equal((await db.account.findUniqueOrThrow({where:{code}})).name,name);assert.equal(await db.account.count(),92);
  await panel.getByRole('button',{name:'Tutup formulir',exact:true}).click();await panel.getByRole('button',{name:'Tutup & buang isian',exact:true}).click();await panel.waitFor({state:'hidden'});
  pass('duplicate COA code is rejected without overwriting account; discard closes safely');
  for(const width of[320,390,768,1024]){await page.setViewportSize({width,height:844});await open();assert.ok(await page.evaluate(()=>{const element=document.querySelector('[data-creation-panel]');return element.scrollWidth<=element.clientWidth+1&&document.documentElement.scrollWidth<=innerWidth+1;}));await page.screenshot({path:join(screenshots,`coa-panel-${width}.png`),caret:'initial'});await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});}
  pass('COA panel fits four responsive widths and reopens with empty fields');
  await page.goto(origin+'/coa/baru?year=2037');await page.locator('main #code').waitFor();assert.equal(await page.locator('main h1').innerText(),'Tambah akun');assert.equal(await panel.getAttribute('open'),null);
  await page.goto(origin+'/coa/'+account.id+'?year=2037');await page.waitForFunction(()=>document.querySelector('main #code')?.value==='1199.99');assert.equal(await panel.getAttribute('open'),null);
  pass('direct create URL and existing account edit retain protected full-page fallback');
  assert.equal(await db.journalEntry.count(),0);assert.equal(await db.journalLine.count(),0);
  pass('COA panel creates no journal, journal line or opening balance');
}

export async function checkCreationPanels({ page, db, origin, screenshots, pass }) {
  const panel = page.locator("[data-creation-panel]");
  const open = async item => {
    await page.getByRole("link", { name: item.trigger }).first().click();
    await panel.waitFor({ state: "visible" });
    await page.waitForFunction(() => Boolean(document.querySelector("[data-creation-panel][open] #date")?.value));
    assert.equal(await panel.locator("#date").inputValue(), "2037-01-01");
  };

  for (const [index, item] of cases.entries()) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(origin + item.path + "?year=2037&q=Panel+QA&status=unpaid");
    await page.waitForLoadState("networkidle");
    const originalURL = page.url(), backgroundTitle = await page.locator("main h1").innerText();
    await open(item);
    assert.equal(page.url(), originalURL);
    assert.equal(await page.locator("main h1").innerText(), backgroundTitle);
    assert.ok(await page.locator("main h1").isVisible());
    const box = await panel.boundingBox();
    assert.ok(box.x > 0 && Math.abs(box.x + box.width - 1440) < 2, "Panel slides in from right, with background visible");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
    await panel.getByRole("button", { name: "Periksa & lanjutkan", exact: true }).click();
    assert.ok((await panel.getByRole("alert").allTextContents()).some(text => text.trim()), "Empty form has inline validation");
    await panel.locator("#" + item.field).fill(item.name);
    await panel.locator("#amount").fill(item.amount);
    await panel.locator("#" + item.choice).selectOption({ index: 1 });
    await page.screenshot({ path: join(screenshots, "creation-" + item.kind + "-desktop.png"), caret: "initial" });
    await panel.getByRole("button", { name: "Tutup formulir", exact: true }).click();
    await panel.getByRole("heading", { name: "Tutup formulir?", exact: true }).waitFor();
    await panel.getByRole("button", { name: "Lanjutkan mengisi", exact: true }).click();
    assert.equal(await panel.locator("#" + item.field).inputValue(), item.name);
    await panel.getByRole("button", { name: "Periksa & lanjutkan", exact: true }).click();
    await panel.getByRole("heading", { name: "Periksa sebelum mencatat", exact: true }).waitFor();
    await panel.getByRole("button", { name: "Ubah isian", exact: true }).click();
    assert.equal(await panel.locator("#" + item.field).inputValue(), item.name);
    await panel.getByRole("button", { name: "Periksa & lanjutkan", exact: true }).click();

    if (index === 0) {
      let release, started;
      const gate = new Promise(resolve => { release = resolve; }), requestStarted = new Promise(resolve => { started = resolve; });
      const matcher = url => url.pathname === item.path;
      const handler = async route => { if (route.request().method() === "POST") { started(); await gate; } await route.continue(); };
      await page.route(matcher, handler);
      try {
        await panel.getByRole("button", { name: "Simpan & Catat", exact: true }).dblclick();
        await requestStarted;
        await page.waitForFunction(() => document.querySelector('[data-creation-panel] button[aria-label="Tutup formulir"]')?.disabled);
        await page.keyboard.press("Escape");
        assert.ok(await panel.isVisible(), "Cannot dismiss during a save");
        release();
        await panel.getByRole("button", { name: "Selesai", exact: true }).waitFor();
        pass("creation panel blocks dismissal during saving and accepts double-click safely");
      } finally { release(); await page.unroute(matcher, handler); }
    } else {
      await panel.getByRole("button", { name: "Simpan & Catat", exact: true }).dblclick();
      await panel.getByRole("button", { name: "Selesai", exact: true }).waitFor();
    }

    const record = item.kind === "loan" ? await db.loan.findFirstOrThrow({ where: { employeeName: item.name } }) : await db.tradeDocument.findFirstOrThrow({ where: { partyName: item.name } });
    const number = item.kind === "loan" ? record.loanNumber : record.documentNumber;
    assert.ok(number.startsWith(item.prefix + "-"));
    assert.ok((await panel.innerText()).includes(number));
    assert.equal(await db.journalEntry.count(), index + 1);
    assert.equal((await db.journalEntry.findUniqueOrThrow({ where: { id: record.journalEntryId } })).status, "POSTED");
    await page.waitForFunction(() => !document.querySelector('[data-creation-panel] button[aria-label="Tutup formulir"]')?.disabled);
    await panel.getByRole("button", { name: "Selesai", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    await page.getByRole("link", { name: item.name, exact: true }).waitFor();
    assert.equal(page.url(), originalURL);
    assert.equal(await page.locator("#q").inputValue(), "Panel QA");
    assert.equal(await page.locator("#year").inputValue(), "2037");
    assert.equal(await page.locator("#status").inputValue(), "unpaid");
    await open(item);
    assert.equal(await panel.locator("#" + item.field).inputValue(), "");
    await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" });
    await open(item); await page.mouse.click(40, 300); await panel.waitFor({ state: "hidden" });
    pass(item.kind + " panel preserves background/filter, validates, reviews, saves once, refreshes list and resets on reopen");
  }

  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const item of cases) {
      await page.goto(origin + item.path + "?year=2037"); await page.waitForLoadState("networkidle"); await open(item);
      assert.ok(await page.evaluate(() => { const modal = document.querySelector("[data-creation-panel]"); return document.documentElement.scrollWidth <= innerWidth + 1 && modal.scrollWidth <= modal.clientWidth + 1; }), "No horizontal overflow in panel");
      await page.screenshot({ path: join(screenshots, `creation-${item.kind}-${width}.png`), caret: "initial" });
      await panel.getByRole("button", { name: "Tutup formulir", exact: true }).click(); await panel.waitFor({ state: "hidden" });
    }
  }
  pass("three creation panels fit 320/390/768/1024px (12 responsive layouts)");

  const customer = cases[1];
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(origin + customer.path + "?year=2037"); await page.waitForLoadState("networkidle");
  let abort = true;
  const matcher = url => url.pathname === customer.path;
  const handler = async route => { if (abort && route.request().method() === "POST") { abort = false; await route.abort("failed"); } else await route.continue(); };
  await page.route(matcher, handler);
  try {
    await page.getByRole("link", { name: customer.trigger }).first().click();
    await panel.getByRole("button", { name: "Coba lagi", exact: true }).waitFor();
    await panel.getByRole("button", { name: "Coba lagi", exact: true }).click();
    await panel.locator("#partyName").waitFor();
    await page.keyboard.press("Escape"); await panel.waitFor({ state: "hidden" });
  } finally { await page.unroute(matcher, handler); }
  pass("creation form loading failure is recoverable without leaving list");

  for (const item of cases) {
    await page.goto(origin + item.path + "/baru?year=2037");
    await page.waitForFunction(() => Boolean(document.querySelector("main #date")?.value));
    assert.equal(await page.locator("main h1").innerText(), item.title);
    assert.equal(await panel.getAttribute("open"), null);
  }
  pass("direct/new-tab creation URLs retain protected full-page fallback");
  assert.equal(await db.journalEntry.count(), 3);
  assert.equal(await db.loan.count(), 1); assert.equal(await db.tradeDocument.count(), 2);
  pass("opening, closing, resizing, retrying and rendering panels create no extra journals");
}
