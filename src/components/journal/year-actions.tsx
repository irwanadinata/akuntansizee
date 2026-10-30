"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { journalAction } from "@/app/(admin)/jurnal/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function YearAction({ year, currentYear }: { year?: { id: string; version: number; status: string }; currentYear?: number }) {
  const router = useRouter(), request = useRef({ fingerprint: "", key: "" });
  const [pending, startTransition] = useTransition(), [message, setMessage] = useState(""), [value, setValue] = useState(String(currentYear ?? ""));
  return <form className="flex flex-wrap items-start gap-2" onSubmit={event => {
    event.preventDefault();
    const payload = year ? { id: year.id, version: year.version, status: year.status === "OPEN" ? "LOCKED" : "OPEN", reason: value } : { year: Number(value) };
    const fingerprint = JSON.stringify(payload);
    if (request.current.fingerprint !== fingerprint) request.current = { fingerprint, key: crypto.randomUUID() };
    startTransition(async () => { try { const response = await journalAction(year ? "SET_YEAR_STATUS" : "CREATE_YEAR", { ...payload, requestKey: request.current.key }); setMessage(response.message); if (response.ok) router.refresh(); } catch { setMessage("Koneksi terputus. Coba lagi dengan isi yang sama."); } });
  }}><Input className="max-w-64" aria-label={year ? "Alasan mengubah status tahun" : "Tahun buku baru"} type={year ? "text" : "number"} value={value} onChange={event => setValue(event.target.value)} placeholder={year ? "Alasan perubahan status" : "Tahun, misalnya 2026"} min={year ? undefined : 1900} max={year ? undefined : 2199} minLength={year ? 3 : undefined} maxLength={year ? 1000 : undefined} required /><Button loading={pending} loadingText="Menyimpan…" type="submit" variant={year ? "outline" : "default"} disabled={pending}>{year ? year.status === "OPEN" ? "Kunci tahun" : "Buka tahun" : "Tambah tahun buku"}</Button>{message && <p className="w-full text-sm" role="status">{message}</p>}</form>;
}
