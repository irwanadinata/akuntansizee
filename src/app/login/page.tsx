import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpenCheck, LockKeyhole, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { getAdminSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Masuk" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getAdminSession()) redirect("/");

  return (
    <main className="min-h-svh bg-background lg:grid lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute -right-32 top-24 size-[32rem] rounded-full border border-white/10" aria-hidden="true" />
        <div className="absolute -right-12 top-44 size-96 rounded-full border border-white/10" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-white/15"><BookOpenCheck className="size-6" aria-hidden="true" /></div>
          <div><p className="text-xl font-semibold tracking-tight">Akuntansi Zee</p><p className="mt-0.5 text-sm text-primary-foreground/65">PT Zee Komunikasi Indonesia</p></div>
        </div>
        <div className="relative max-w-lg py-16">
          <p className="mb-5 text-sm font-semibold uppercase tracking-[0.2em] text-primary-foreground/60">Pembukuan perusahaan</p>
          <p className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">Catatan rapi.<br />Langkah lebih pasti.</p>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-primary-foreground/70">Kelola pembukuan PT Zee Komunikasi Indonesia dalam satu ruang kerja yang sederhana dan teratur.</p>
        </div>
        <p className="relative flex items-center gap-2 text-sm text-primary-foreground/60"><ShieldCheck className="size-4" aria-hidden="true" />Ruang kerja internal perusahaan</p>
      </section>
      <section className="flex min-h-svh items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden"><div className="rounded-xl bg-primary p-3 text-primary-foreground"><BookOpenCheck className="size-6" aria-hidden="true" /></div><div><p className="font-semibold">Akuntansi Zee</p><p className="text-sm text-muted-foreground">PT Zee Komunikasi Indonesia</p></div></div>
          <div className="mb-6 inline-flex size-12 items-center justify-center rounded-2xl border bg-card text-primary"><LockKeyhole className="size-5" aria-hidden="true" /></div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Selamat datang</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Masuk ke ruang kerja</h1>
          <p className="mb-8 mt-3 text-sm leading-relaxed text-muted-foreground">Gunakan akun admin untuk mengakses pembukuan perusahaan.</p>
          <LoginForm />
          <p className="mt-8 border-t pt-6 text-center text-sm leading-relaxed text-muted-foreground">Akses khusus admin PT Zee Komunikasi Indonesia.<br />Hubungi pengelola aplikasi jika memerlukan bantuan masuk.</p>
        </div>
      </section>
    </main>
  );
}
