import type { TradeSearchParams } from "@/components/trade/server-views";
import { requireAdmin } from "@/lib/auth/session";
import { NewTradeDocumentView } from "@/components/trade/server-views";

export const metadata = { title: "Buat Tagihan Customer" };

export default async function NewCustomerInvoicePage({searchParams}:{searchParams:Promise<TradeSearchParams>}) {
  await requireAdmin();
  return <NewTradeDocumentView kind="RECEIVABLE" searchParams={await searchParams} />;
}
