import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inventory Check — Color Graphics",
  description: "Verify Syncore sales orders against live vendor inventory.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-cg-bg text-cg-text">{children}</body>
    </html>
  );
}
