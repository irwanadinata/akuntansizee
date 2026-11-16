"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SearchAccount = { id: string; code: string; name: string; description: string | null };

export function AccountSearch({ accounts, defaultValue = "" }: { accounts: SearchAccount[]; defaultValue?: string }) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const term = query.trim().toLocaleLowerCase("id-ID");
  const matches = term ? accounts.filter(account => [account.code, account.name, account.description ?? ""].some(value => value.toLocaleLowerCase("id-ID").includes(term))) : [];
  const expanded = open && Boolean(term);
  const activeIndex = active < matches.length ? active : -1;

  const position = useCallback(() => {
    if (!input.current || !popup.current) return;
    const rect = input.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
    const popupWidth = Math.min(Math.max(rect.width, 320), width - 24);
    const below = top + height - rect.bottom - 12, above = rect.top - top - 12;
    const upwards = below < 220 && above > below;
    popup.current.style.width = `${popupWidth}px`;
    popup.current.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - popupWidth - 12))}px`;
    popup.current.style.top = upwards ? "auto" : `${rect.bottom + 6}px`;
    popup.current.style.bottom = upwards ? `${window.innerHeight - rect.top + 6}px` : "auto";
    popup.current.style.maxHeight = `${Math.min(360, Math.max(96, upwards ? above : below))}px`;
  }, []);

  useEffect(() => {
    const element = popup.current;
    if (!expanded || !element) return;
    position();
    element.showPopover();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      element.hidePopover();
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [expanded, position]);

  useEffect(() => {
    if (expanded && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded, listId]);

  function choose(account: SearchAccount) {
    flushSync(() => { setQuery(account.code); setOpen(false); setActive(-1); });
    input.current?.form?.requestSubmit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && term) {
      event.preventDefault();
      setOpen(true);
      if (matches.length) setActive(!expanded || activeIndex < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1) : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      if (expanded && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]); }
      else setOpen(false);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Tab") setOpen(false);
  }

  return <div ref={root} onBlur={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Input ref={input} id="q" name="q" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listId}
      aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      placeholder="Kode, nama, keterangan" maxLength={100} autoComplete="off" value={query}
      onChange={event => { setQuery(event.target.value); setOpen(true); setActive(-1); if (popup.current) popup.current.scrollTop = 0; }}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKeyDown} />
    <div ref={popup} popover="manual" className="fixed m-0 overflow-y-auto overscroll-contain rounded-xl border border-input bg-background p-1.5 text-foreground shadow-xl">
      <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{matches.length ? `${matches.length} rekomendasi akun · Pilih untuk menerapkan` : "Akun tidak ditemukan. Coba kode atau nama lain."}</p>
      <div id={listId} role="listbox" aria-label="Rekomendasi akun">
        {matches.map((account, index) => <button key={account.id} id={`${listId}-${index}`} type="button" role="option" aria-selected={index === activeIndex} tabIndex={-1}
          className={cn("flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-accent", index === activeIndex && "bg-accent")}
          onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(index)} onClick={() => choose(account)}>
          <span className="font-mono text-xs text-primary">{account.code}</span>
          <span className="w-full break-words font-medium">{account.name}</span>
          {account.description && <span className="line-clamp-2 w-full break-words text-xs text-muted-foreground">{account.description}</span>}
        </button>)}
      </div>
    </div>
  </div>;
}
