import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <Card className="w-full max-w-xl">
        <EmptyState icon={FileQuestion} title="Halaman tidak ditemukan" description="Alamat yang Anda buka tidak tersedia. Kembali ke Beranda untuk memilih menu pembukuan.">
          <Button asChild><Link href="/"><ArrowLeft aria-hidden="true" />Kembali ke Beranda</Link></Button>
        </EmptyState>
      </Card>
    </main>
  );
}
