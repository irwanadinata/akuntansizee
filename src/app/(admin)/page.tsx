import Link from "@/components/year-link";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, BookOpenCheck, Landmark, UsersRound, Wallet } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";

const overview = [
  { title: "Kas & Bank", description: "Uang perusahaan", icon: Wallet, href: "/buku-besar" },
  { title: "Piutang Customer", description: "Tagihan yang perlu diterima", icon: ArrowDownLeft, href: "/piutang-customer" },
  { title: "Utang Supplier", description: "Tagihan yang perlu dibayar", icon: ArrowUpRight, href: "/utang-supplier" },
  { title: "Pinjaman Karyawan", description: "Pinjaman dan cicilan", icon: UsersRound, href: "/pinjaman-karyawan" },
];

const shortcuts = [
  { title: "Piutang Customer", description: "Lihat tagihan dan penerimaan pembayaran.", href: "/piutang-customer", icon: ArrowDownLeft },
  { title: "Utang Supplier", description: "Lihat tagihan dan pembayaran supplier.", href: "/utang-supplier", icon: ArrowUpRight },
  { title: "Pinjaman Karyawan", description: "Lihat pinjaman dan riwayat cicilan.", href: "/pinjaman-karyawan", icon: UsersRound },
];

export default async function HomePage() {
  await requireAdmin();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm font-semibold tracking-[0.14em] text-primary uppercase">Beranda</p>
          <h1 className="text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">Pembukuan perusahaan, lebih tertata.</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Pantau tagihan, pinjaman, dan laporan keuangan dalam satu ruang kerja.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary"><BookOpenCheck className="size-3.5" aria-hidden="true" />Pembukuan internal</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {overview.map(({ title, description, icon: Icon, href }) => (
          <Card key={title} className="overflow-hidden shadow-none">
            <Link href={href} className="block rounded-2xl p-5 outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring">
              <div className="mb-5 flex items-center justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-secondary text-primary"><Icon className="size-5" strokeWidth={1.7} aria-hidden="true" /></span><ArrowRight className="size-4 text-muted-foreground/60" aria-hidden="true" /></div>
              <h2 className="text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
              <div className="mt-5 border-t border-border pt-3"><p className="text-sm text-muted-foreground">Buka rincian</p></div>
            </Link>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-5"><h2 className="text-base font-semibold">Ringkasan keuangan</h2></div>
        <EmptyState icon={Landmark} title="Lihat laporan sesuai Tahun Buku" description="Buka Neraca dan Laba Rugi gabungan untuk memeriksa posisi keuangan, hasil usaha dan kecocokan saldo kontrol.">
          <Button asChild variant="outline"><Link href="/laporan-keuangan">Lihat Laporan Keuangan<ArrowRight aria-hidden="true" /></Link></Button>
        </EmptyState>
      </Card>

      <section aria-labelledby="shortcuts-heading">
        <h2 id="shortcuts-heading" className="text-base font-semibold">Akses cepat</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pilih bagian pembukuan yang ingin Anda lihat.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {shortcuts.map(({ title, description, href, icon: Icon }) => (
            <Link key={href} href={href} className="group flex items-start gap-3 rounded-xl border border-border bg-card p-5 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring">
              <Icon className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
              <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p></div>
              <ArrowRight className="mt-0.5 ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
