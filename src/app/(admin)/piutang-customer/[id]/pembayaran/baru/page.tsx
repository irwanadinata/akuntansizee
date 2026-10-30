import type { TradeSearchParams } from "@/components/trade/server-views";
import { requireAdmin } from "@/lib/auth/session";
import { NewTradePaymentView } from "@/components/trade/server-views";

export const metadata = { title: "Terima Pembayaran Customer" };

export default async function NewCustomerReceiptPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<TradeSearchParams> }) {
  await requireAdmin();
  return <NewTradePaymentView kind="RECEIVABLE" id={(await params).id} searchParams={await searchParams} />;
}
