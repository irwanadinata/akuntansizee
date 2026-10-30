"use client";
import { Button } from "@/components/ui/button";
import { useState } from "react";
export function PrintButton(){const[pending,setPending]=useState(false);return <Button type="button" variant="outline" loading={pending} loadingText="Menyiapkan cetak…" onClick={()=>{setPending(true);requestAnimationFrame(()=>requestAnimationFrame(()=>{try{window.print();}finally{setPending(false);}}));}}>Cetak / Simpan PDF browser</Button>;}
