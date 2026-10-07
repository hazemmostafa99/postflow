import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(marketingUrl),
  title: {
    default: "iPostFlow — Social publishing built for sales",
    template: "%s | iPostFlow",
  },
  description:
    "Plan, publish, track, and turn social activity into sales opportunities with iPostFlow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} min-h-screen font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
