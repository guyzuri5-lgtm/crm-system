import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

// Rubik: excellent Hebrew + Latin support, warm and modern — a real upgrade over the
// Arial fallback for an all-Hebrew, RTL interface.
const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: "מערכת CRM",
  description: "ניהול לידים, וואטסאפ ומייל במקום אחד",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${rubik.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
