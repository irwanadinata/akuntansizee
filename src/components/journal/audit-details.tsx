import {z} from "zod";
import type {Prisma} from "@/generated/prisma/client";
import {displayDate} from "@/lib/accounting/dates";
import {formatRupiah} from "@/lib/accounting/money";
const snapshot=z.object({journalNumber:z.string(),date:z.string(),description:z.string(),lines:z.array(z.object({accountId:z.string(),debit:z.string().regex(/^\d+$/),credit:z.string().regex(/^\d+$/),description:z.string()}))});
const change=z.object({reason:z.string(),before:snapshot,after:snapshot});
export function JournalAuditDetails({details,accounts}:{details:Prisma.JsonValue;accounts:Record<string,string>}){
 const parsed=change.safeParse(details);if(!parsed.success)return null;
 return <details className="mt-2 rounded-lg border p-3"><summary className="cursor-pointer font-medium">Lihat nilai sebelum dan sesudah</summary><p className="mt-3">Alasan: {parsed.data.reason}</p><div className="mt-4 grid gap-4 xl:grid-cols-2">{(["before","after"]as const).map(side=>{const value=parsed.data[side];return <section key={side} className="min-w-0 space-y-2 rounded-lg bg-muted p-3"><h3 className="font-semibold">{side==="before"?"Sebelum":"Sesudah"}</h3><p className="break-all font-mono">{value.journalNumber}</p><p>{displayDate(value.date)} · {value.description}</p><div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-xs"><thead><tr><th className="p-2">Akun</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Kredit</th></tr></thead><tbody>{value.lines.map((line,index)=><tr key={index} className="border-t"><td className="p-2">{accounts[line.accountId]??"Akun tersimpan"}{line.description&&<p className="mt-1 text-muted-foreground">{line.description}</p>}</td><td className="whitespace-nowrap p-2 text-right">{formatRupiah(line.debit)}</td><td className="whitespace-nowrap p-2 text-right">{formatRupiah(line.credit)}</td></tr>)}</tbody></table></div></section>})}</div></details>;
}
