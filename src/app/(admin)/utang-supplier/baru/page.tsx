import type { TradeSearchParams } from "@/components/trade/server-views";
import { requireAdmin } from "@/lib/auth/session";
import { NewTradeDocumentView } from "@/components/trade/server-views";

export const metadata = { title: "Catat Tagihan Supplier" };

export default async function NewSupplierBillPage({searchParams}:{searchParams:Promise<TradeSearchParams>}) {
  await requireAdmin();
  return <NewTradeDocumentView kind="PAYABLE" searchParams={await searchParams} />;
}
