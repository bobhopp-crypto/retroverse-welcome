import type { Metadata, Viewport } from "next";
import { Fraunces, Source_Serif_4 } from "next/font/google";

import { RetroverseTopChrome } from "@/app/components/retroverse-top-chrome";
import { RetroverseTransportDeck } from "@/app/components/retroverse-transport-deck";
import RetroverseRouteTuner from "./retroverse-route-tuner";

import "./globals.css";
import "./retroverse-public.css";

const rvDisplay = Fraunces({
  variable: "--font-rv-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const rvBody = Source_Serif_4({
  variable: "--font-rv-body",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#03070a",
};

export const metadata: Metadata = {
  title: "Retroverse",
  description: "A music time machine — search artists, albums, and chart history.",
  applicationName: "Retroverse",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Retroverse",
  },
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${rvDisplay.variable} ${rvBody.variable} h-full antialiased`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="rv-public-surface rv-has-transport min-h-full flex flex-col bg-[var(--bg-main)] text-[var(--text-primary)]">
        <RetroverseRouteTuner />
        <RetroverseTopChrome />
        <main className="rv-main-stage flex min-h-0 flex-1 flex-col">{children}</main>
        <RetroverseTransportDeck />
      </body>
    </html>
  );
}
