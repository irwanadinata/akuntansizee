"use client";
import { FilterSubmitButton } from "@/components/loading/filter-content";
import { useRef, useState } from "react";
import { jakartaDate } from "@/lib/accounting/dates";
import type { YearOption } from "@/lib/fiscal/selection";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilterBar, filterSelectClass } from "@/components/filter-bar";
import { AccountSelect } from "@/components/coa/account-select";
export function PeriodFilters({action,years,year,from,to,ledger,accounts=[],accountId="",hideZero=true}:{action:string;years:YearOption[];year:string;from:string;to:string;ledger?:boolean;accounts?:{id:string;code:string;name:string}[];accountId?:string;hideZero?:boolean}) {
  const [selected,setSelected]=useState(year||"all"),[start,setStart]=useState(from),[end,setEnd]=useState(to);
  const [account,setAccount]=useState(accountId),[accountError,setAccountError]=useState(false);
  const accountTrigger=useRef<HTMLButtonElement>(null);
  return <FilterBar action={action} title="Filter laporan" columns={4} actions={<FilterSubmitButton>Tampilkan</FilterSubmitButton>} onSubmit={event=>{
    if(ledger&&!accounts.some(item=>item.id===account)){event.preventDefault();setAccountError(true);accountTrigger.current?.focus();}
  }}>
    {ledger&&<div className="min-w-0 space-y-2"><Label htmlFor="accountId">Akun</Label>
      <AccountSelect ref={accountTrigger} id="accountId" name="accountId" accounts={accounts} value={account} onChange={value=>{setAccount(value);setAccountError(false);}} placeholder="Pilih akun COA" invalid={accountError} aria-describedby={accountError?"accountId-error":undefined}/>
      {accountError&&<p id="accountId-error" role="alert" className="text-sm text-destructive">Pilih akun COA terlebih dahulu.</p>}
    </div>}
    <div className="space-y-2"><Label htmlFor="year">Tahun Buku</Label><select className={filterSelectClass} id="year" name="year" value={selected} onChange={event=>{const next=event.target.value,today=jakartaDate();setSelected(next);if(next!=="all"){setStart(next+"-01-01");setEnd(today.slice(0,4)===next?today:next+"-12-31");}}}>{ledger&&<option value="all">Lintas / semua tahun</option>}{years.map(item=><option key={item.id} value={item.year}>{item.year} · {item.status==="OPEN"?"Terbuka":"Terkunci"}</option>)}</select></div>
    <div className="space-y-2"><Label htmlFor="from">{ledger?"Dari tanggal":"Dari tanggal (Laba Rugi)"}</Label><Input id="from" name="from" type="date" value={start} onChange={event=>setStart(event.target.value)} required/></div>
    <div className="space-y-2"><Label htmlFor="to">{ledger?"Sampai tanggal":"Sampai / per tanggal"}</Label><Input id="to" name="to" type="date" value={end} onChange={event=>setEnd(event.target.value)} required/></div>
    {!ledger&&<div className="space-y-2"><Label htmlFor="hideZero">Akun bersaldo nol</Label><select id="hideZero" name="hideZero" className={filterSelectClass} defaultValue={String(hideZero)}><option value="true">Sembunyikan</option><option value="false">Tampilkan</option></select></div>}
  </FilterBar>;
}
