export function validBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 1900;
}
export function asDate(value: string): Date {
  if (!validBusinessDate(value)) throw new Error("Tanggal transaksi tidak sah.");
  return new Date(value + "T00:00:00.000Z");
}
export function dateString(value: Date): string { return value.toISOString().slice(0, 10); }
export function jakartaDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return get("year") + "-" + get("month") + "-" + get("day");
}
export function displayDate(value: Date | string): string {
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(typeof value === "string" ? asDate(value) : value);
}
export function displayTime(value: Date) {
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(value) + " WIB";
}

