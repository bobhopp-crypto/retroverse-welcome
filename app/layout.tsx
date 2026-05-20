import type { Metadata, Viewport } from "next";
import { Fraunces, Source_Serif_4 } from "next/font/google";
import Link from "next/link";

import { PRIMARY_NAV } from "@/lib/retroverse-nav";
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
  description: "Search music history — artists, albums, and chart runs.",
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
      <body className="rv-public-surface min-h-full flex flex-col bg-[var(--bg-main)] text-[var(--text-primary)]">
        <RetroverseRouteTuner />
        <header className="rv-global-header" role="banner">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-5">
            <Link href="/" className="rv-public-wordmark">
              Retroverse
            </Link>
            <nav className="flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:gap-x-3" aria-label="Primary">
              {PRIMARY_NAV.filter((item) => item.href !== "/").map((item) => (
                <Link key={item.href} className="rv-public-header-link" href={item.href}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col pt-[var(--rv-header-offset)]">{children}</main>
      </body>
    </html>
  );
}
