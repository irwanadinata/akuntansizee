import assert from "node:assert/strict";
import test from "node:test";
import { balanceWarnings, reportNotices, OPENING_BALANCE_WARNING, BALANCE_WARNING } from "../src/lib/reports/diagnostics";
import { syntheticReport } from "./fixtures/report";

test("saldo awal bank belum lengkap dijelaskan sekali dengan nominal dan status belum final", () => {
  const report = syntheticReport();
  report.balance.difference = report.diagnostics.openingDifference = "3000000";
  report.diagnostics.warnings = balanceWarnings("3000000", "3000000");
  report.diagnostics.canUse = false;
  assert.deepEqual(report.diagnostics.warnings, [OPENING_BALANCE_WARNING]);
  const [notice] = reportNotices(report);
  assert.equal(reportNotices(report).length, 1);
  assert.equal(notice.title, "Saldo awal belum seimbang");
  assert.equal(notice.status, "Belum final");
  assert.match(notice.paragraphs[0], /telah tercatat.*aset, utang, dan ekuitas.*pembukuan lama/);
  assert.equal(notice.paragraphs[1], "Selisih neraca: Rp 3.000.000");
  assert.ok(!JSON.stringify(notice).includes("tanpa akun lawan"));
});

test("ketidaksesuaian lain tetap terlihat bersama saldo awal yang belum seimbang", () => {
  const report = syntheticReport();
  report.balance.difference = "3000001";
  report.diagnostics.openingDifference = "3000000";
  report.diagnostics.warnings = [...balanceWarnings("3000000", "3000001"), "Saldo akun kontrol berbeda dengan rincian subledger."];
  const notices = reportNotices(report);
  assert.equal(notices.length, 2);
  assert.equal(notices[0].kind, "opening");
  assert.equal(notices[1].kind, "review");
  assert.ok(notices[1].paragraphs.includes(BALANCE_WARNING));
  assert.match(notices[1].paragraphs[1], /akun kontrol/);
  assert.equal(notices[0].paragraphs[1], "Selisih neraca: Rp 3.000.001");
});

test("saldo lengkap tidak diberi peringatan; selisih tanpa saldo awal tetap diperingatkan", () => {
  assert.deepEqual(balanceWarnings("0", "0"), []);
  assert.deepEqual(reportNotices(syntheticReport()), []);
  assert.deepEqual(balanceWarnings("0", "-1"), [BALANCE_WARNING]);
  assert.deepEqual(balanceWarnings("100", "0"), [OPENING_BALANCE_WARNING]);
  assert.deepEqual(balanceWarnings("-3000000", "-3000000"), [OPENING_BALANCE_WARNING]);
});
