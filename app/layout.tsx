import type { Metadata } from "next";
import { Mulish, Kaushan_Script } from "next/font/google";
import "./globals.css";

const mulish = Mulish({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700", "800", "900"],
  variable: "--font-mulish",
  display: "swap",
});

const kaushan = Kaushan_Script({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-kaushan",
  display: "swap",
});

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
    <html lang="en" className={`${mulish.variable} ${kaushan.variable}`}>
      <body className="min-h-screen bg-cg-n-50 text-cg-n-900 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
