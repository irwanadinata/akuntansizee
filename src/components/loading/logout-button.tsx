"use client";
import { useFormStatus } from "react-dom";
import { LoaderCircle, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
export function LogoutButton(){const {pending}=useFormStatus();return <Button variant="ghost" type="submit" disabled={pending} aria-busy={pending} className="px-3 text-muted-foreground">{pending?<LoaderCircle className="animate-spin" aria-hidden="true"/>:<LogOut aria-hidden="true"/>}<span>Keluar</span>{pending&&<span role="status" className="sr-only">Sedang keluar dari aplikasi…</span>}</Button>;}
