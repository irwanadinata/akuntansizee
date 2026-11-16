"use client";
import { useFiscalHref } from "@/components/use-fiscal-href";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { saveAccountAction } from "@/app/(admin)/coa/actions";
import { accountFieldsSchema, mustReview, type AccountInput } from "@/lib/coa/validation";
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
  const [review, setReview] = useState<AccountInput | null>(null);
  const busy = useRef(false);
  const router = useRouter(),scopedHref=useFiscalHref();
  const { register, handleSubmit, control, setValue, getValues, formState: { errors, isDirty } } = useForm<AccountInput>({
    resolver: zodResolver(accountFieldsSchema),
    defaultValues: initial ? { code: initial.code, name: initial.name, description: initial.description,
      mainType: initial.mainType, reportGroup: initial.reportGroup, normalBalance: initial.normalBalance,
      isContra: initial.isContra, isControlAccount: initial.isControlAccount, isActive: initial.isActive,
      requiresReview: initial.requiresReview, reviewConfirmed: false, reviewReason: initial.reviewReason } : { code: "", name: "", description: "", mainType: "ASSET", reportGroup: "CURRENT_ASSET",
      normalBalance: "DEBIT", isContra: false, isControlAccount: false, isActive: true, requiresReview: false, reviewConfirmed: false, reviewReason: "" },
  });
  const panel = usePanelForm({ dirty: isDirty, pending, saved: Boolean(saved) });
  const mainType = useWatch({ control, name: "mainType" });
  const reportGroup = useWatch({ control, name: "reportGroup" });
  const normalBalance = useWatch({ control, name: "normalBalance" });
  const fixedNormalBalance = ["CONTRA_REVENUE", "DIVIDENDS"].includes(reportGroup);
  const locked = Boolean(initial?.used || initial?.isControlAccount);
  function error(field: keyof AccountInput) { return errors[field]?.message ? <p className="mt-1 text-sm text-destructive" role="alert">{errors[field]?.message}</p> : null; }
  function submit(values: AccountInput) {
    if (busy.current || saved) return;
    const changed = !initial || (["mainType", "reportGroup", "normalBalance", "isContra", "isControlAccount"] as const)
      .some(key => initial[key] !== values[key]);
    if (mustReview(values) && (!initial?.reviewConfirmed || changed || !mustReview(initial))) {
      setMessage(""); setReview(values); return;
    }
    save({ ...values, reviewConfirmed: Boolean(initial?.reviewConfirmed && !changed) });
  }
  function save(values: AccountInput) {
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
  if (review) return <section className={panel ? "space-y-5" : "max-w-3xl space-y-5 rounded-2xl border bg-card p-5 sm:p-7"}>
    <h2 className="text-xl font-semibold">Periksa akun khusus</h2>
    <p className="text-sm text-muted-foreground">Akun ini memiliki pengaturan khusus. Pastikan klasifikasi berikut sudah sesuai sebelum menyimpannya.</p>
    <dl className="divide-y rounded-xl border px-4 text-sm">{[
      ["Kode akun", review.code], ["Nama akun", review.name], ["Jenis akun", typeLabels[review.mainType]],
      ["Kelompok laporan", groupLabel(review.reportGroup)], ["Saldo normal", review.normalBalance === "DEBIT" ? "Debit" : "Kredit"],
    ].map(([label, value]) => <div key={label} className="grid gap-1 py-3 sm:grid-cols-[160px_minmax(0,1fr)]"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl>
    {review.isContra && <p className="rounded-lg bg-secondary p-4 text-sm">Akun ini mengurangi nilai kelompok laporannya.</p>}
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button loading={pending} loadingText="Menyimpan…" onClick={() => save({ ...review, reviewConfirmed: true })}>Simpan akun</Button>
      <Button variant="outline" disabled={pending} onClick={() => { setReview(null); setMessage(""); }}>Ubah isian</Button>
    </div>
  </section>;
  return <form className={panel ? "space-y-7" : "max-w-3xl space-y-7 rounded-2xl border bg-card p-5 sm:p-7"} onSubmit={event => { void handleSubmit(submit)(event); }} noValidate>
    {locked && <p className="rounded-lg bg-secondary p-4 text-sm">{initial?.used ? "Akun pernah digunakan. Kode dan klasifikasi dikunci untuk menjaga histori." : "Kode dan klasifikasi akun ini dikelola sistem."} Nama dan keterangan masih dapat diubah.</p>}
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="code">Kode akun</Label><Input id="code" {...register("code")} readOnly={locked} aria-invalid={Boolean(errors.code)} placeholder="Misalnya 1112.4" />{error("code")}<p className="text-sm text-muted-foreground">Kode disimpan sebagai teks dan harus unik.</p></div>
      <div className="space-y-2"><Label htmlFor="name">Nama akun</Label><Input id="name" {...register("name")} aria-invalid={Boolean(errors.name)} />{error("name")}</div>
    </div>
    <div className="space-y-2"><Label htmlFor="description">Keterangan singkat</Label><textarea id="description" rows={3} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary" {...register("description")} />{error("description")}</div>
    {locked ? <div className="rounded-lg border p-4 text-sm"><p>{typeLabels[initial!.mainType]} · {groupLabel(initial!.reportGroup)} · Saldo normal {initial!.normalBalance === "DEBIT" ? "Debit" : "Kredit"}</p></div> : <>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="mainType">Jenis akun</Label><select id="mainType" className={selectClass} {...register("mainType", { onChange: event => {
          const next = event.target.value as AccountInput["mainType"];
          setValue("reportGroup", reportGroups.find(group => groupDefinitions[group][1] === next)!);
          setValue("normalBalance", ["ASSET", "COGS", "EXPENSE"].includes(next) ? "DEBIT" : "CREDIT");
          setValue("isContra", false);
        } })}>{mainTypes.map(type => <option key={type} value={type}>{typeLabels[type]}</option>)}</select>{error("mainType")}</div>
        <div className="space-y-2"><Label htmlFor="reportGroup">Kelompok laporan</Label><select id="reportGroup" className={selectClass} {...register("reportGroup", { onChange: event => {
          const wasFixed = ["CONTRA_REVENUE", "DIVIDENDS"].includes(reportGroup);
          const contra = ["CONTRA_REVENUE", "DIVIDENDS"].includes(event.target.value)
            || (wasFixed ? Boolean(initial?.isContra) : getValues("isContra"));
          const debit = ["ASSET", "COGS", "EXPENSE"].includes(getValues("mainType"));
          setValue("isContra", contra); setValue("normalBalance", debit !== contra ? "DEBIT" : "CREDIT");
        } })}>{reportGroups.filter(group => groupDefinitions[group][1] === mainType).map(group => <option key={group} value={group}>{groupLabel(group)}</option>)}</select>{error("reportGroup")}</div>
        <div className="space-y-2"><Label htmlFor="normalBalance">Saldo normal</Label>{fixedNormalBalance
          ? <Input id="normalBalance" value={normalBalance === "DEBIT" ? "Debit" : "Kredit"} readOnly />
          : <select id="normalBalance" className={selectClass} {...register("normalBalance", { onChange: event => {
            const usual = ["ASSET", "COGS", "EXPENSE"].includes(getValues("mainType")) ? "DEBIT" : "CREDIT";
            setValue("isContra", event.target.value !== usual);
          } })}><option value="DEBIT">Debit</option><option value="CREDIT">Kredit</option></select>}{error("normalBalance")}{error("isContra")}<p className="text-sm text-muted-foreground">Sifat debit/kredit akun, bukan nominal saldo awal.</p></div>
      </div>
    </>}
    <p className="text-sm text-muted-foreground">{!initial ? "Akun baru akan aktif setelah disimpan." : initial.isActive ? "Akun ini aktif. Status dapat diubah melalui daftar COA." : "Akun ini nonaktif. Gunakan Aktifkan pada daftar COA untuk menggunakannya kembali."}</p>
    <p className="text-sm text-muted-foreground">Tidak ada input saldo. Saldo keuangan berasal dari jurnal yang diposting.</p>
    {message && <p role="status" className="rounded-lg border p-3 text-sm">{message}</p>}
    <div className={"flex flex-wrap gap-3" + (panel ? " transaction-panel-actions" : "")}><Button loading={pending} type="submit" disabled={pending}>{pending ? "Menyimpan…" : "Simpan akun"}</Button><CreationCancel href="/coa" /></div>
  </form>;
}

