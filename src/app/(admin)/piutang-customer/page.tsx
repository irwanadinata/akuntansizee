import { requireAdmin } from "@/lib/auth/session";
import { TradeListView, type TradeSearchParams } from "@/components/trade/server-views";

export const metadata = { title: "Piutang Customer" };

export default async function CustomerReceivablesPage({ searchParams }: { searchParams: Promise<TradeSearchParams> }) {
  await requireAdmin();
  return <TradeListView kind="RECEIVABLE" searchParams={await searchParams} />;
}
