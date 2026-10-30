import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Akuntansi Zee | PT Zee Komunikasi Indonesia",
    template: "%s | Akuntansi Zee",
  },
  description: "Pembukuan internal PT Zee Komunikasi Indonesia.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
