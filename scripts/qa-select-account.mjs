// Works for both page forms and the creation dialog's searchable account picker.
export async function selectAccount(scope, selector, query = "") {
  await scope.locator(selector).click();
  const popup = scope.locator("[data-account-options]:popover-open");
  if (query) await popup.getByRole("combobox", { name: "Cari kode atau nama akun" }).fill(query);
  await popup.getByRole("option").first().click();
}
