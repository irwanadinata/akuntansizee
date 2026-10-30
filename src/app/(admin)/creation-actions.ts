"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { assertTrustedOrigin } from "@/lib/auth/origin";
import { getAuthEnv } from "@/lib/env/server";
import { getPrisma } from "@/lib/db";
import { withFiscalYear } from "@/lib/fiscal/context";
import { fiscalDate } from "@/lib/fiscal/selection";
import { jakartaDate } from "@/lib/accounting/dates";
import { cashChoices } from "@/lib/loans/queries";
import { counterChoices } from "@/lib/trade/queries";
import { creationKinds, type CreationDataResult } from "@/lib/transactions/creation";

const inputSchema = z.object({ kind: z.enum(creationKinds), year: z.literal("all").or(z.string().regex(/^(19|20|21)\d{2}$/)) }).strict();

// Only loads permitted account choices. Saving still uses the existing commands.
export async function loadCreationForm(input: unknown): Promise<CreationDataResult> {
  await requireAdmin();
  try {
    assertTrustedOrigin((await headers()).get("origin"), getAuthEnv().APP_ORIGIN);
    const { kind, year } = inputSchema.parse(input);
    if (kind === "account") return { ok: true, data: { kind } };
    const scope = await withFiscalYear({ year });
    const today = fiscalDate(scope.year, jakartaDate());
    if (kind === "loan") return { ok: true, data: { kind, today, accounts: await cashChoices(getPrisma()) } };
    return { ok: true, data: { kind, today, accounts: await counterChoices(getPrisma(), kind === "receivable" ? "RECEIVABLE" : "PAYABLE") } };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, message: "Pilihan formulir atau Tahun Buku tidak sah." };
    return { ok: false, message: "Formulir belum dapat dimuat. Coba lagi atau hubungi pengelola." };
  }
}
