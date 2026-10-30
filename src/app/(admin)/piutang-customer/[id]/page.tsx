import { requireAdmin } from "@/lib/auth/session";
import { TradeDetailView, type TradeSearchParams } from "@/components/trade/server-views";

export const metadata = { title: "Rincian Tagihan Customer" };

export default async function CustomerInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<TradeSearchParams> }) {
  await requireAdmin();
  return <TradeDetailView kind="RECEIVABLE" id={(await params).id} searchParams={await searchParams} />;
}
