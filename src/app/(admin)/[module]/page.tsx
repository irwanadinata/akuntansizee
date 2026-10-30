import type { Metadata } from "next";
import Link from "@/components/year-link";
import { ArrowLeft, PanelsTopLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { getModuleNavigation } from "@/lib/navigation";

type ModulePageProps = { params: Promise<{ module: string }> };

export async function generateMetadata({ params }: ModulePageProps): Promise<Metadata> {
  const item = getModuleNavigation((await params).module);
  return { title: item?.title ?? "Halaman tidak ditemukan" };
}

export default async function ModulePage({ params }: ModulePageProps) {
  await requireAdmin();

  const item = getModuleNavigation((await params).module);
  if (!item) notFound();

  return (
    <div className="space-y-7">
      <div>
        <p className="mb-2 text-sm font-semibold tracking-[0.14em] text-primary uppercase">Ruang kerja</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{item.title}</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{item.description}</p>
      </div>
      <Card>
        <EmptyState icon={PanelsTopLeft} title="Halaman ini sedang disiapkan" description="Ruang kerja sudah tersedia. Pencatatan transaksi dan laporan akan ditambahkan pada tahap berikutnya.">
          <Button variant="outline" asChild><Link href="/"><ArrowLeft aria-hidden="true" />Kembali ke Beranda</Link></Button>
        </EmptyState>
      </Card>
    </div>
  );
}
