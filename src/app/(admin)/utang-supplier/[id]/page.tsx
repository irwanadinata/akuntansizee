import { requireAdmin } from "@/lib/auth/session";
import { TradeDetailView, type TradeSearchParams } from "@/components/trade/server-views";

export const metadata = { title: "Rincian Tagihan Supplier" };

export default async function SupplierBillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<TradeSearchParams> }) {
  await requireAdmin();
  return <TradeDetailView kind="PAYABLE" id={(await params).id} searchParams={await searchParams} />;
}
