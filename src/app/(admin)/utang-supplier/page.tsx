import { requireAdmin } from "@/lib/auth/session";
import { TradeListView, type TradeSearchParams } from "@/components/trade/server-views";

export const metadata = { title: "Utang Supplier" };

export default async function SupplierPayablesPage({ searchParams }: { searchParams: Promise<TradeSearchParams> }) {
  await requireAdmin();
  return <TradeListView kind="PAYABLE" searchParams={await searchParams} />;
}
