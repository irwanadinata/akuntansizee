"use client";
import { Input } from "@/components/ui/input";
import { formatInteger, rupiah } from "@/lib/accounting/money";
export function MoneyInput({ id, value, onChange, onBlur, invalid }: { id:string; value:string; onChange:(value:string)=>void; onBlur:()=>void; invalid:boolean }) {
  return <div className="flex items-center rounded-lg border border-input bg-background"><span className="pl-3 text-sm text-muted-foreground">Rp</span><Input id={id} value={value} onBlur={onBlur} inputMode="numeric" maxLength={40} className="border-0 shadow-none" aria-invalid={invalid} onChange={event => {
    const element = event.currentTarget, text = element.value, inputType = (event.nativeEvent as InputEvent).inputType;
    if (!/^[\d.]*$/.test(text)) { onChange(text); return; }
    if (inputType === "insertFromPaste") { try { rupiah(text); } catch { onChange(text); return; } }
    const digitsBefore = text.slice(0,element.selectionStart ?? text.length).replace(/\D/g,"").length;
    const digits=text.replace(/\./g,""), normalized=digits.replace(/^0+(?=\d)/, ""), formatted=normalized ? formatInteger(normalized) : ""; onChange(formatted);
    const targetDigits=Math.max(0,digitsBefore-(digits.length-normalized.length));
    requestAnimationFrame(() => { if (!element.isConnected) return; let position=0,seen=0; while(position<formatted.length && seen<targetDigits) { if (/\d/.test(formatted[position])) seen++; position++; } element.setSelectionRange(position,position); });
  }} /></div>;
}
