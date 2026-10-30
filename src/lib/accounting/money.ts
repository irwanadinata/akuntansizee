export const MAX_RUPIAH = 99999999999999999999n;
export function rupiah(value: string): string {
  const text = value.trim();
  if (text === "") return "0";
  if (!/^\d+$/.test(text) && !/^[1-9]\d{0,2}(?:\.\d{3})+$/.test(text)) throw new Error("Isi Rupiah bulat dengan digit atau pemisah ribuan titik.");
  const number = BigInt(text.replace(/\./g, ""));
  if (number > MAX_RUPIAH) throw new Error("Nominal melebihi batas penyimpanan Rupiah.");
  return number.toString();
}
export function formatInteger(value: string | bigint): string {
  const text = String(value);
  const negative = text.startsWith("-");
  const digits = negative ? text.slice(1) : text;
  return (negative ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
export function formatRupiah(value: string | bigint): string { return "Rp " + formatInteger(value); }
export function normalBalance(netDebit: bigint, normal: "DEBIT" | "CREDIT") { return normal === "DEBIT" ? netDebit : -netDebit; }

