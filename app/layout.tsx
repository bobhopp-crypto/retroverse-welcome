import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Retroverse Welcome",
  description: "Retroverse early-access welcome page",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-theme="vivid"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <header className="rv-global-header" role="banner">
          <div className="mx-auto flex w-full max-w-[46rem] items-center gap-2 px-4 py-2 sm:px-6">
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Home
            </Link>
            <Link
              href="/week"
              className="inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              This Week in History
            </Link>
            <Link
              href="/eras"
              className="inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Eras
            </Link>
          </div>
        </header>
        <main className="flex-1 pt-[var(--rv-header-offset)]">{children}</main>
      </body>
    </html>
  );
}
