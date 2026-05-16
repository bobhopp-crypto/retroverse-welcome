import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#03070a",
};

export const metadata: Metadata = {
  title: "Retroverse",
  description: "Chart memory — albums, artists, and eras.",
  applicationName: "Retroverse Portal",
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

const navLink =
  "text-[0.68rem] uppercase tracking-[0.16em] text-[var(--text-secondary)] transition hover:text-[var(--accent-primary)]";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-theme="dark"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-[var(--bg-main)] text-[var(--text-primary)]">
        <header className="rv-global-header" role="banner">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-5">
            <Link
              href="/album-retroscope"
              className="font-serif text-[1.05rem] tracking-[0.04em] text-[var(--text-primary)] sm:text-[1.12rem]"
            >
              Retroverse
            </Link>
            <nav className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-4" aria-label="Primary">
              <Link className={navLink} href="/portal-v2">
                Portal
              </Link>
              <Link className={navLink} href="/eras">
                Eras
              </Link>
              <Link className={navLink} href="/artists">
                Artists
              </Link>
              <Link className={navLink} href="/albums">
                Albums
              </Link>
              <Link className={navLink} href="/search">
                Search
              </Link>
              <Link className={navLink} href="/index">
                Index
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col pt-[var(--rv-header-offset)]">{children}</main>
      </body>
    </html>
  );
}
