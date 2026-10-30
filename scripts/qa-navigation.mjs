import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { navigationGroups, navigationItems } from "../src/lib/navigation.ts";

const title = "Akuntansi PT Zee Komunikasi Indonesia";

export async function checkNavigation({ page, db, origin, screenshots, directory, pass }) {
  await page.goto(origin + "/jurnal?year=2037"); await page.waitForLoadState("networkidle");
  const desktop = page.locator('[data-sidebar="desktop"]'), mobile = page.locator('[data-sidebar="mobile"]');
  assert.equal(await desktop.locator("[data-app-brand-label]").textContent(), title);
  assert.equal(await desktop.locator(".sidebar-frame > div").count(), 2, "Desktop sidebar has only brand and navigation, no company footer");
  assert.ok(!(await desktop.innerText()).includes("Pembukuan perusahaan"));
  pass("company footer removed and app brand uses full requested company name");

  async function settled(sidebar, height) {
    const mode = height < 600 ? "compact" : "full";
    await page.waitForFunction(([selector, expected]) => document.querySelector(selector + " [data-nav-mode]")?.dataset.navMode === expected, ['[data-sidebar="' + await sidebar.getAttribute("data-sidebar") + '"]', mode]);
  }
  async function measure(sidebar, width, height) {
    const metrics = await sidebar.evaluate(element => {
      const region = element.querySelector(".sidebar-navigation-region"), nav = region.querySelector("nav"), bounds = element.getBoundingClientRect(), area = region.getBoundingClientRect();
      const interactive = [...nav.querySelectorAll("a[href],button")].filter(item => item.getClientRects().length);
      const frame = element.querySelector(".sidebar-frame"), brand = element.querySelector("[data-app-brand-label]"), brandRow = element.querySelector(".sidebar-brand-row").getBoundingClientRect(), brandBox = brand.getBoundingClientRect();
      return {
        height: bounds.height, mode: nav.dataset.navMode, regionFits: region.scrollHeight <= region.clientHeight + 1, sidebarFits: element.scrollHeight <= element.clientHeight + 1 && frame.scrollHeight <= frame.clientHeight + 1,
        noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
        controlsFit: interactive.every(item => { const box = item.getBoundingClientRect(); return box.top >= area.top - 1 && box.bottom <= area.bottom + 1 && box.left >= bounds.left - 1 && box.right <= bounds.right + 1 && box.height >= 24; }),
        brandFits: brand.scrollWidth <= brand.clientWidth + 1 && brandBox.top >= brandRow.top - 1 && brandBox.bottom <= brandRow.bottom + 1,
        scrollTop: region.scrollTop, linkCount: nav.querySelectorAll("[data-sidebar-link]").length,
      };
    });
    assert.ok(Math.abs(metrics.height - height) < 2, `${width}x${height}: sidebar matches viewport height`);
    assert.ok(metrics.regionFits && metrics.sidebarFits && metrics.controlsFit && metrics.brandFits && metrics.noHorizontalOverflow, `${width}x${height}: all visible controls and brand fit without scrolling: ${JSON.stringify(metrics)}`);
    assert.equal(metrics.scrollTop, 0);
    if (height >= 600) assert.equal(metrics.linkCount, navigationItems.length);
    return { width, height, ...metrics };
  }
  async function allGroups(sidebar, width, height) {
    const nav = sidebar.locator("[data-nav-mode]");
    if (await nav.locator("[data-nav-back]").count()) await nav.locator("[data-nav-back]").click();
    const found = new Set((await nav.locator("[data-sidebar-link]").evaluateAll(links => links.map(link => new URL(link.href).pathname))));
    for (const group of navigationGroups.filter(item => item.title !== "Ruang kerja")) {
      await nav.locator("[data-nav-group]").filter({ hasText: group.title }).click();
      await page.waitForFunction(selector => document.querySelector(selector + " [data-nav-back]"), '[data-sidebar="' + await sidebar.getAttribute("data-sidebar") + '"]');
      assert.equal(await nav.locator("[data-sidebar-link]").count(), group.items.length);
      await measure(sidebar, width, height);
      for (const link of await nav.locator("[data-sidebar-link]").evaluateAll(links => links.map(link => link.href))) { const url = new URL(link); found.add(url.pathname); assert.equal(url.searchParams.get("year"), "2037"); }
      assert.ok(await nav.evaluate(element => element.contains(document.activeElement)), "Submenu receives keyboard focus");
      await nav.locator("[data-nav-back]").click();
      await page.waitForFunction(([selector, label]) => document.activeElement?.matches(selector + " [data-nav-group]") && document.activeElement.dataset.navGroup === label, ['[data-sidebar="' + await sidebar.getAttribute("data-sidebar") + '"]', group.title]);
    }
    assert.deepEqual([...found].sort(), navigationItems.map(item => item.href).sort(), "All twelve destinations remain reachable in short windows");
  }

  const layouts = [];
  for (const width of [1024, 1280, 1440, 1920]) for (const height of [200, 280, 320, 390, 480, 600, 640, 700, 768, 800, 900, 1080]) {
    await page.setViewportSize({ width, height }); await settled(desktop, height);
    layouts.push({ surface: "desktop", ...await measure(desktop, width, height) });
    if (width === 1280 && [200, 480].includes(height)) await allGroups(desktop, width, height);
    if ((width === 1440 && height === 900) || (width === 1280 && height === 480)) await page.screenshot({ path: join(screenshots, `sidebar-${width}-${height}.png`), caret: "initial" });
  }
  pass("desktop sidebar fits 48 width/height combinations with no scrolling or clipped menus");

  for (const width of [320, 390, 768, 844]) for (const height of [200, 280, 320, 390, 568, 667, 844, 932]) {
    await page.setViewportSize({ width, height });
    if (!(await mobile.isVisible())) await page.getByRole("button", { name: "Buka menu utama", exact: true }).click();
    await settled(mobile, height);
    assert.equal(await mobile.locator("[data-app-brand-label]").textContent(), title);
    layouts.push({ surface: "mobile", ...await measure(mobile, width, height) });
    if ((width === 320 && height === 200) || (width === 844 && height === 390)) await allGroups(mobile, width, height);
    if ((width === 390 && height === 844) || (width === 844 && height === 390)) await page.screenshot({ path: join(screenshots, `sidebar-${width}-${height}.png`), caret: "initial" });
    await page.getByRole("button", { name: "Tutup menu utama", exact: true }).click(); await mobile.waitFor({ state: "hidden" });
    assert.equal(await page.locator('header [data-app-brand-label]').textContent(), title);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Navbar full title does not overflow");
  }
  pass("mobile sidebar and full navbar title fit 32 portrait/landscape combinations without scrolling");
  pass("all twelve menu destinations remain accessible through short-screen groups with keyboard focus restored");

  await page.setViewportSize({ width: 1440, height: 900 }); await settled(desktop, 900);
  await page.setViewportSize({ width: 1440, height: 320 }); await settled(desktop, 320); await measure(desktop, 1440, 320);
  await page.setViewportSize({ width: 1440, height: 900 }); await settled(desktop, 900); await measure(desktop, 1440, 900);
  pass("sidebar reacts to live height changes and restores the full menu");

  await page.setViewportSize({ width: 844, height: 390 }); await page.getByRole("button", { name: "Buka menu utama", exact: true }).click(); await settled(mobile, 390);
  const nav = mobile.locator("nav"); if (await nav.locator("[data-nav-back]").count()) await nav.locator("[data-nav-back]").click();
  await nav.locator('[data-nav-group="Laporan"]').click(); await nav.getByRole("link", { name: "Neraca", exact: true }).click(); await page.waitForURL(url => url.pathname === "/neraca");
  assert.equal(new URL(page.url()).searchParams.get("year"), "2037"); await mobile.waitFor({ state: "hidden" });
  pass("compact menu navigation preserves fiscal year and closes the mobile panel");

  await page.setViewportSize({ width: 390, height: 844 }); const trigger = page.getByRole("button", { name: "Buka menu utama", exact: true }); await trigger.click(); await settled(mobile, 844);
  await page.keyboard.press("Shift+Tab"); assert.ok(await mobile.evaluate(element => element.contains(document.activeElement)));
  await page.keyboard.press("Escape"); await mobile.waitFor({ state: "hidden" }); assert.ok(await trigger.evaluate(element => element === document.activeElement));
  await trigger.click(); await page.mouse.click(380, 300); await mobile.waitFor({ state: "hidden" });
  pass("mobile sidebar retains focus, Escape and backdrop controls");
  await trigger.click(); await page.setViewportSize({ width: 1440, height: 900 }); await mobile.waitFor({ state: "hidden" });
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
  pass("switching to desktop dismisses mobile navigation and unlocks page scrolling");
  assert.equal(await db.journalEntry.count(), 0);
  writeFileSync(join(directory, "navigation-result.json"), JSON.stringify(layouts, null, 2));
}
