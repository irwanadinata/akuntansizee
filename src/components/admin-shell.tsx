"use client";
import { LogoutButton } from "@/components/loading/logout-button";

import Link from "@/components/year-link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, BookOpenCheck, CalendarDays, ChartNoAxesCombined, ChevronLeft, ChevronRight, CircleUserRound, Download, Files, House, Landmark, LayoutList, Menu, NotebookPen, UsersRound, X, type LucideIcon } from "lucide-react";

import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { navigationGroups, navigationItems, type NavigationItem } from "@/lib/navigation";
import { FiscalProvider } from "@/components/fiscal-context";
import { FiscalYearSelector } from "@/components/fiscal-year-selector";
import { selectedYear,requiresSingleFiscalYear,type YearOption } from "@/lib/fiscal/selection";
import { cn } from "@/lib/utils";

const icons: Record<NavigationItem["icon"], LucideIcon> = {
  home: House,
  receivable: ArrowDownLeft,
  payable: ArrowUpRight,
  loan: UsersRound,
  journal: NotebookPen,
  ledger: BookOpen,
  balance: Landmark,
  profit: ChartNoAxesCombined,
  reports: Files,
  accounts: LayoutList,
  year: CalendarDays,
  opening: BookOpenCheck,
};

const appTitle = "Akuntansi PT Zee Komunikasi Indonesia";
function Brand({ navbar = false }: { navbar?: boolean }) {
  return (
    <Link href="/" data-app-brand className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={appTitle + ", Beranda"}>
      {!navbar && <span className="sidebar-brand-icon flex shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-xs">
        <BookOpenCheck className="size-5" aria-hidden="true" />
      </span>}
      <span className="min-w-0 text-sm leading-[1.3] font-semibold text-pretty [overflow-wrap:anywhere]" data-app-brand-label>{appTitle}</span>
    </Link>
  );
}

function Navigation({ pathname, onNavigate, mobile = false, year = "", fallback = "" }: { pathname: string; onNavigate?: () => void; mobile?: boolean; year?: string; fallback?: string }) {
  const [compact, setCompact] = useState(false);
  const navigation = useRef<HTMLElement>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null | undefined>(undefined);
  const isActive = (item: NavigationItem) => item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const grouped = navigationGroups.filter(group => group.title !== "Ruang kerja");
  const activeGroup = grouped.find(group => group.items.some(isActive));
  const currentGroup = selectedGroup === undefined ? activeGroup : grouped.find(group => group.title === selectedGroup);

  useEffect(() => {
    const sidebar = navigation.current?.closest<HTMLElement>("[data-sidebar]");
    if (!sidebar) return;
    const observer = new ResizeObserver(([entry]) => setCompact(entry.contentRect.height < 600));
    observer.observe(sidebar);
    return () => observer.disconnect();
  }, []);

  function chooseGroup(title: string) {
    setSelectedGroup(title);
    requestAnimationFrame(() => navigation.current?.querySelector<HTMLElement>("[data-sidebar-link]")?.focus({ preventScroll: true }));
  }
  function showGroups() {
    const title = currentGroup?.title;
    setSelectedGroup(null);
    requestAnimationFrame(() => [...(navigation.current?.querySelectorAll<HTMLButtonElement>("[data-nav-group]") ?? [])].find(button => button.dataset.navGroup === title)?.focus({ preventScroll: true }));
  }

  function renderItem(item: NavigationItem) {
    const Icon = icons[item.icon], active = isActive(item);
    const targetYear = requiresSingleFiscalYear(item.href) ? (year || fallback) : (year || "all");
    return <li key={item.href}><Link href={item.href + "?year=" + targetYear} data-sidebar-link onClick={() => { setSelectedGroup(undefined); onNavigate?.(); }} aria-current={active ? "page" : undefined} className={cn("sidebar-link flex items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", active ? "bg-primary/10 font-semibold text-accent-foreground" : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
      <Icon className="size-[18px] shrink-0" strokeWidth={1.7} aria-hidden="true" /><span className="min-w-0 whitespace-nowrap">{item.title}</span>{active && <ChevronRight className="ml-auto size-4 shrink-0 text-primary/70" aria-hidden="true" />}
    </Link></li>;
  }

  return (
    <nav ref={navigation} aria-label={mobile ? "Menu utama ponsel" : "Menu utama"} className="sidebar-nav" data-nav-mode={compact ? "compact" : "full"}>
      {compact ? currentGroup ? <>
        <button type="button" data-nav-back className="sidebar-link flex w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" onClick={showGroups}><ChevronLeft className="size-[18px] shrink-0" aria-hidden="true" />Semua menu</button>
        <div><p className="sidebar-group-title px-3 text-xs font-semibold tracking-wide text-muted-foreground">{currentGroup.title}</p><ul className="sidebar-list">{currentGroup.items.map(renderItem)}</ul></div>
      </> : <ul className="sidebar-list">
        {renderItem(navigationItems[0])}
        {grouped.map(group => { const Icon = icons[group.items[0].icon], active = group === activeGroup; return <li key={group.title}><button type="button" data-nav-group={group.title} aria-current={active ? "true" : undefined} onClick={() => chooseGroup(group.title)} className={cn("sidebar-link flex w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/10 text-accent-foreground" : "text-muted-foreground")}><Icon className="size-[18px] shrink-0" aria-hidden="true" /><span>{group.title}</span><ChevronRight className="ml-auto size-4 shrink-0" aria-hidden="true" /></button></li>; })}
      </ul> : navigationGroups.map((group) => (
        <div key={group.title}>
          {group.title !== "Ruang kerja" && <p className="sidebar-group-title px-3 text-xs font-semibold tracking-wide text-muted-foreground">{group.title}</p>}
          <ul className="sidebar-list">{group.items.map(renderItem)}</ul>
        </div>
      ))}
    </nav>
  );
}

export function AdminShell({ children, adminEmail, years, defaultYear, preferredYear }: { children: ReactNode; adminEmail: string; years: YearOption[]; defaultYear: string; preferredYear: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const allowAll = !requiresSingleFiscalYear(pathname);
  const baseYear=allowAll?preferredYear:defaultYear;
  const year = selectedYear(search.get("year") ?? undefined,years,baseYear,allowAll);
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const activePage = navigationItems.find((item) => item.href === pathname || (item.href !== "/" && pathname.startsWith(item.href + "/")));

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) dialog.current?.close(); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  function openMenu() { dialog.current?.showModal(); setMenuOpen(true); }
  function closeMenu() { dialog.current?.close(); }
  function keepMenuFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const targets = [...event.currentTarget.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>("a[href], button:not(:disabled)")].filter(element => element.getClientRects().length > 0);
    const first = targets[0], last = targets[targets.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return (
    <FiscalProvider value={{years,defaultYear,preferredYear}}><div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <a href="#main-content" className="fixed top-3 left-3 z-50 -translate-y-24 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-white outline-none focus:translate-y-0">Lewati ke konten utama</a>
      <aside data-print-hide data-sidebar="desktop" className="sidebar sticky top-0 hidden h-dvh overflow-hidden flex-col border-r bg-background lg:flex">
        <div className="sidebar-frame flex h-full min-h-0 flex-col">
        <div className="sidebar-brand-row flex shrink-0 items-center px-5"><Brand /></div>
        <div className="sidebar-navigation-region min-h-0 flex-1 overflow-hidden px-3"><Navigation pathname={pathname} year={year} fallback={defaultYear} /></div>
        </div>
      </aside>
      <div className="min-w-0">
        <header data-print-hide className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm">
          <div className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto_auto] lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="outline" size="icon" aria-label="Buka menu utama" aria-expanded={menuOpen} aria-controls="mobile-navigation" className="shrink-0 lg:hidden" onClick={openMenu}><Menu aria-hidden="true" /></Button>
              <div className="min-w-0 lg:hidden"><Brand navbar /></div>
              <nav aria-label="Lokasi halaman" className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
                <Link href="/" className="shrink-0 rounded text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" aria-label="Beranda"><House className="size-4" aria-hidden="true" /></Link>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className="truncate font-medium" title={activePage?.title}>{activePage?.title ?? appTitle}</span>
              </nav>
            </div>
            <div className="col-span-2 row-start-2 grid min-w-0 gap-3 min-[420px]:grid-cols-[minmax(0,1fr)_auto] md:col-span-1 md:col-start-2 md:row-start-1 md:flex md:items-center">
              <div className="min-w-0 md:w-48 xl:w-56"><FiscalYearSelector years={years} fallback={baseYear} /></div>
              <Button asChild variant="default" className="h-11 px-3 text-white">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- This route serves an attachment through native browser navigation. */}
                <a href="/panduan"><Download aria-hidden="true" />Buku Panduan</a>
              </Button>
            </div>
            <div className="col-start-2 row-start-1 flex items-center gap-3 md:col-start-3">
              <div className="hidden min-w-0 items-center gap-2 border-l pl-4 sm:flex">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-muted-foreground"><CircleUserRound className="size-5" aria-hidden="true" /></span>
                <div className="hidden min-w-0 xl:block">
                  <p className="text-sm font-semibold text-foreground">Admin</p>
                  <p className="max-w-36 truncate text-xs text-muted-foreground" title={adminEmail}>{adminEmail}</p>
                </div>
              </div>
              <form action={logout}>
                <LogoutButton/>
              </form>
            </div>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-[1600px] px-4 py-6 outline-none sm:px-6 sm:py-8 lg:px-8">{children}</main>
        <footer data-print-hide className="px-4 pb-6 text-xs text-muted-foreground sm:px-6 lg:px-8">PT Zee Komunikasi Indonesia <span className="mx-2" aria-hidden="true">·</span> Pembukuan internal</footer>
      </div>
      <dialog ref={dialog} id="mobile-navigation" aria-label="Navigasi utama" data-sidebar="mobile" data-print-hide onClose={() => setMenuOpen(false)} onKeyDown={keepMenuFocus} onClick={event => { if (event.target === event.currentTarget) closeMenu(); }} className="sidebar mobile-navigation fixed inset-y-0 left-0 m-0 h-dvh max-h-none w-[min(86vw,320px)] max-w-none overflow-hidden border-0 bg-background p-0 text-foreground shadow-xl backdrop:bg-slate-950/40">
        <div className="sidebar-frame flex h-full min-h-0 flex-col">
          <div className="sidebar-brand-row flex shrink-0 items-center justify-between gap-2 border-b px-4"><Brand /><Button variant="ghost" size="icon" aria-label="Tutup menu utama" onClick={closeMenu}><X aria-hidden="true" /></Button></div>
          <div className="sidebar-navigation-region min-h-0 flex-1 overflow-hidden px-3"><Navigation pathname={pathname} year={year} fallback={defaultYear} mobile onNavigate={closeMenu} /></div>
          <div className="mobile-navigation-account shrink-0 border-t px-5 py-4"><p className="text-sm font-semibold">Admin</p><p className="mt-1 truncate text-xs text-muted-foreground" title={adminEmail}>{adminEmail}</p></div>
        </div>
      </dialog>
    </div></FiscalProvider>
  );
}
