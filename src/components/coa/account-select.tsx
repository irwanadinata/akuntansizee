"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type AccountChoice = { id: string; code: string; name: string; group?: string };
type Props = {
  accounts: AccountChoice[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  ref?: Ref<HTMLButtonElement>;
  id?: string;
  name?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function AccountSelect({ accounts, value, onChange, onBlur, ref, id, name, placeholder = "Pilih akun", disabled, invalid, "aria-label": ariaLabel, "aria-describedby": describedBy }: Props) {
  const uniqueId = useId();
  const popupId = `${uniqueId}-accounts`, listId = `${uniqueId}-list`;
  const trigger = useRef<HTMLButtonElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = accounts.find(account => account.id === value);
  const terms = query.trim().toLocaleLowerCase("id-ID").split(/\s+/).filter(Boolean);
  const matches = accounts.filter(account => terms.every(term => `${account.code} ${account.name} ${account.group ?? ""}`.toLocaleLowerCase("id-ID").includes(term)));
  const activeIndex = Math.min(active, Math.max(0, matches.length - 1));

  const position = useCallback(() => {
    if (!trigger.current || !popup.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewLeft = viewport?.offsetLeft ?? 0, viewTop = viewport?.offsetTop ?? 0;
    const viewWidth = viewport?.width ?? window.innerWidth, viewHeight = viewport?.height ?? window.innerHeight;
    const width = Math.min(Math.max(rect.width, 280), viewWidth - 24);
    const below = viewTop + viewHeight - rect.bottom - 12, above = rect.top - viewTop - 12;
    const upwards = below < 220 && above > below;
    const height = Math.min(360, Math.max(120, upwards ? above : below));
    const left = Math.max(viewLeft + 12, Math.min(rect.left, viewLeft + viewWidth - width - 12));
    popup.current.style.left = `${left}px`;
    popup.current.style.top = upwards ? "auto" : `${rect.bottom + 6}px`;
    popup.current.style.bottom = upwards ? `${window.innerHeight - rect.top + 6}px` : "auto";
    popup.current.style.right = "auto";
    popup.current.style.width = `${width}px`;
    popup.current.style.maxHeight = `${height}px`;
    popup.current.style.setProperty("--account-list-height", `${height - 96}px`);
  }, []);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, position]);

  function close(restoreFocus = false) {
    popup.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  function choose(accountId: string) {
    onChange(accountId);
    close(true);
  }

  function move(index: number) {
    setActive(index);
    const option = document.getElementById(`${listId}-${index}`);
    if (!option || !list.current) return;
    const row = option.getBoundingClientRect(), bounds = list.current.getBoundingClientRect();
    if (row.top < bounds.top) list.current.scrollTop -= bounds.top - row.top;
    else if (row.bottom > bounds.bottom) list.current.scrollTop += row.bottom - bounds.bottom;
  }

  function searchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (matches.length) move((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (matches[activeIndex]) choose(matches[activeIndex].id);
    } else if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); close(true);
    }
  }

  return <>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
    <button id={id} type="button" ref={node => {
      trigger.current = node;
      if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
    }} disabled={disabled} popoverTarget={popupId} role="combobox" aria-haspopup="dialog" aria-expanded={open} aria-controls={popupId}
      aria-label={ariaLabel} aria-invalid={invalid} aria-describedby={describedBy} data-account-select
      className={cn("flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50 aria-invalid:border-destructive", !selected && "text-muted-foreground")}
      onClick={() => { setQuery(""); position(); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setQuery(""); position(); popup.current?.showPopover();
        }
      }}>
      <span className="truncate">{selected ? `${selected.code} · ${selected.name}` : value ? "Akun tidak tersedia" : placeholder}</span>
      <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
    <div id={popupId} ref={popup} popover="auto" role="dialog" aria-label={placeholder} data-account-options
      className="fixed m-0 overflow-hidden rounded-xl border border-input bg-background p-2 text-foreground shadow-xl"
      onToggle={event => {
        const expanded = event.newState === "open";
        setOpen(expanded);
        if (expanded) { position(); move(Math.max(0, accounts.findIndex(account => account.id === value))); search.current?.focus({ preventScroll: true }); }
        else { setQuery(""); onBlur?.(); }
      }}
      onBlur={event => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next) && next !== trigger.current) close();
      }}>
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input ref={search} role="combobox" aria-label="Cari kode atau nama akun" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && matches.length ? `${listId}-${activeIndex}` : undefined}
          value={query} onChange={event => { setQuery(event.target.value); setActive(0); if (list.current) list.current.scrollTop = 0; }} onKeyDown={searchKey}
          placeholder="Cari kode atau nama akun…" autoComplete="off" className="pl-9" />
      </div>
      <p role="status" className="px-2 py-2 text-xs text-muted-foreground">{matches.length ? `${matches.length} akun tersedia` : "Akun tidak ditemukan. Coba kode atau nama lain."}</p>
      <div id={listId} ref={list} role="listbox" aria-label="Daftar akun" className="overflow-y-auto overscroll-contain" style={{ maxHeight: "var(--account-list-height, 272px)" }}>
        {matches.map((account, index) => <button key={account.id} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={account.id === value}
          className={cn("flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent", index === activeIndex && "bg-accent")}
          onMouseDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(account.id)}>
          <span className="min-w-0 flex-1"><span className="block break-words">{account.code} · {account.name}</span>{account.group && <span className="mt-0.5 block text-xs text-muted-foreground">{account.group}</span>}</span>
          {account.id === value && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />}
        </button>)}
      </div>
    </div>
  </>;
}
