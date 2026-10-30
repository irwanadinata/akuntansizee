import type { TradeSearchParams } from "@/components/trade/server-views";
import { requireAdmin } from "@/lib/auth/session";
import { NewTradePaymentView } from "@/components/trade/server-views";

export const metadata = { title: "Bayar Tagihan Supplier" };

export default async function NewSupplierPaymentPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<TradeSearchParams> }) {
  await requireAdmin();
  return <NewTradePaymentView kind="PAYABLE" id={(await params).id} searchParams={await searchParams} />;
}
