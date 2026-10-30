"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="mx-auto max-w-lg rounded-2xl border bg-card p-8">
      <h1 className="text-xl font-semibold">Halaman belum dapat ditampilkan</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Silakan coba kembali. Jika kendala berlanjut, hubungi pengelola aplikasi.
      </p>
      <Button className="mt-6" onClick={reset}>Coba kembali</Button>
    </section>
  );
}

