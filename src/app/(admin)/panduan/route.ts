import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { requireAdmin } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin();

  try {
    const bytes = await readFile(join(process.cwd(), "assets", "guides", "buku-panduan.pdf"));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="buku-panduan-pt-zee-komunikasi-indonesia.pdf"',
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json(
      { error: "Buku panduan belum dapat diunduh. Coba kembali atau hubungi pengelola." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
