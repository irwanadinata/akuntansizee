import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Next logs Server Function arguments by default in development, including
  // login credentials and transaction payloads. Disable that logger explicitly.
  logging: { serverFunctions: false },
  serverExternalPackages: ["pdfkit", "fontkit"],
  outputFileTracingIncludes: {
    "/laporan-keuangan/pdf": ["./assets/fonts/DejaVuSans.ttf", "./assets/fonts/LICENSE-DejaVu.txt"],
    "/panduan": ["./assets/guides/buku-panduan.pdf"],
  },
  // Up to 100 journal lines with 500-character notes; Zod still bounds each field.
  experimental: { serverActions: { bodySizeLimit: "128kb" } },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ...(process.env.NODE_ENV === "production"
          ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
          : []),
      ],
    }];
  },
};

export default nextConfig;

