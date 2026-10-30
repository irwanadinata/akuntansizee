"use client";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saveAccountAction } from "@/app/(admin)/coa/actions";
import { accountInputSchema, type AccountInput } from "@/lib/coa/validation";
import { groupDefinitions, groupLabel, mainTypes, reportGroups, typeLabels } from "@/lib/coa/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePanelForm } from "@/components/transactions/panel-context";
import { CreationCancel } from "@/components/transactions/creation-link";

const selectClass = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary";
export type AccountFormInitial = AccountInput & { id: string; version: number; used: boolean };
export function AccountForm({ initial }: { initial?: AccountFormInitial }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState<{code: string; name: string} | null>(null);
  const busy = useRef(false);
  const router = useRouter(),scopedHref=useFiscalHref();
  const { register, handleSubmit, control, setValue, formState: { errors, isDirty } } = useForm<AccountInput>({
    resolver: zodResolver(accountInputSchema),
    defaultValues: initial ? { code: initial.code, name: initial.name, description: initial.description,
      mainType: initial.mainType, reportGroup: initial.reportGroup, normalBalance: initial.normalBalance,
      isContra: initial.isContra, isControlAccount: initial.isControlAccount, isActive: initial.isActive,
      requiresReview: initial.requiresReview, reviewConfirmed: false, reviewReason: initial.reviewReason } : { code: "", name: "", description: "", mainType: "ASSET", reportGroup: "CURRENT_ASSET",
      normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true, requiresReview: false, reviewConfirmed: false, reviewReason: "" },
  });
  const panel = usePanelForm({ dirty: isDirty, pending, saved: Boolean(saved) });
  const mainType = useWatch({ control, name: "mainType" });
  const locked = initial?.used ?? false;
  function error(field: keyof AccountInput) { return errors[field]?.message ? <p className="mt-1 text-sm text-destructive" role="alert">{errors[field]?.message}</p> : null; }
  function submit(values: AccountInput) {
    if (busy.current || saved) return;
    busy.current = true;
    startTransition(async () => {
      try {
        const result = await saveAccountAction({ account: values, target: initial ? { id: initial.id, version: initial.version } : null });
        setMessage(result.message);
        if (result.ok) {
          if (panel) setSaved({ code: values.code, name: values.name });
          else { router.push(scopedHref("/coa")); router.refresh(); }
        }
      } catch { setMessage("Koneksi terputus. Periksa daftar akun sebelum mencoba kembali; kode akun tetap harus unik."); }
      finally { busy.current = false; }
    });
  }
  if (saved && panel) return <section className="space-y-5 pb-6"><h2 role="status" className="text-lg font-semibold">{message}</h2><p className="break-words text-sm"><span className="font-mono">{saved.code}</span> · {saved.name}</p><p className="text-sm text-muted-foreground">Akun ditambahkan tanpa membuat saldo atau jurnal.</p><Button disabled={pending} onClick={panel.dismiss}>Selesai</Button></section>;
  return <form className={panel ? "space-y-7" : "max-w-3xl space-y-7 rounded-2xl border bg-card p-5 sm:p-7"} onSubmit={event => { void handleSubmit(submit)(event); }} noValidate>
    {locked && <p className="rounded-lg bg-secondary p-4 text-sm">Akun pernah digunakan. Kode, jenis, kelompok, saldo normal dan peran akun dikunci untuk menjaga histori. Nama/keterangan dan status masih dapat diubah.</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="code">Kode akun</Label><Input id="code" {...register("code")} readOnly={locked} aria-invalid={Boolean(errors.code)} placeholder="Misalnya 1112.4" />{error("code")}<p className="text-sm text-muted-foreground">Kode disimpan sebagai teks dan harus unik.</p></div>
      <div className="space-y-2"><Label htmlFor="name">Nama akun</Label><Input id="name" {...register("name")} aria-invalid={Boolean(errors.name)} />{error("name")}</div>
    </div>
    <div className="space-y-2"><Label htmlFor="description">Keterangan singkat</Label><textarea id="description" rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary" {...register("description")} />{error("description")}</div>
    {locked ? <div className="rounded-lg border p-4 text-sm"><p>{typeLabels[initial!.mainType]} · {groupLabel(initial!.reportGroup)} · Saldo normal {initial!.normalBalance === "DEBIT" ? "Debit" : "Kredit"}</p><p className="mt-2 text-muted-foreground">Kontra akun: {initial!.isContra ? "Ya" : "Tidak"} · Akun kontrol: {initial!.isControlAccount ? "Ya" : "Tidak"}</p></div> : <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="mainType">Jenis akun</Label><select id="mainType" className={selectClass} {...register("mainType", { onChange: event => {
          const next = event.target.value as AccountInput["mainType"];
          setValue("reportGroup", reportGroups.find(group => groupDefinitions[group][1] === next)!);
        } })}>{mainTypes.map(type => <option key={type} value={type}>{typeLabels[type]}</option>)}</select>{error("mainType")}</div>
        <div className="space-y-2"><Label htmlFor="reportGroup">Kelompok laporan</Label><select id="reportGroup" className={selectClass} {...register("reportGroup")}>{reportGroups.filter(group => groupDefinitions[group][1] === mainType).map(group => <option key={group} value={group}>{groupLabel(group)}</option>)}</select>{error("reportGroup")}</div>
        <div className="space-y-2"><Label htmlFor="normalBalance">Saldo normal</Label><select id="normalBalance" className={selectClass} {...register("normalBalance")}><option value="DEBIT">Debit</option><option value="CREDIT">Kredit</option></select>{error("normalBalance")}<p className="text-sm text-muted-foreground">Sifat debit/kredit akun, bukan nominal saldo awal.</p></div>
      </div>
      <div className="space-y-3 text-sm">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-primary" {...register("isContra")} /><span>Kontra akun — mengurangi kelompok asalnya</span></label>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-primary" {...register("isControlAccount")} /><span>Akun kontrol — wajib memiliki rincian transaksi yang terkait</span></label>
      </div>
    </>}
    <div className="space-y-3 rounded-xl border p-4 text-sm">
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-primary" {...register("requiresReview")} /><span>Tandai klasifikasi sebagai perlu review</span></label>
      <Label htmlFor="reviewReason">Catatan review (opsional)</Label><Input id="reviewReason" {...register("reviewReason")} />{error("reviewReason")}
      <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-4 accent-primary" {...register("reviewConfirmed")} /><span>Saya sudah memeriksa jenis, kelompok laporan, saldo normal dan peran akun ini.</span></label>{error("reviewConfirmed")}
      <p className="text-muted-foreground">Kontra akun, akun kontrol dan klasifikasi khusus wajib direview sebelum aktif.</p>
    </div>
    <label className="flex items-center gap-3 text-sm font-medium"><input type="checkbox" className="size-4 accent-primary" {...register("isActive")} />Akun aktif dan dapat dipilih untuk transaksi baru</label>
    <p className="text-sm text-muted-foreground">Tidak ada input saldo. Saldo keuangan berasal dari jurnal yang diposting.</p>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className={"flex flex-wrap gap-3" + (panel ? " transaction-panel-actions" : "")}><Button loading={pending} type="submit" disabled={pending}>{pending ? "Menyimpan…" : "Simpan akun"}</Button><CreationCancel href="/coa" /></div>
  </form>;
}

