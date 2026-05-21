"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { backAffordanceForPath } from "@/lib/transport-nav";

export function RetroverseTopChrome() {
  const pathname = usePathname() ?? "/";
  const back = backAffordanceForPath(pathname);

  return (
    <header className="rv-top-chrome" role="banner">
      <div className="rv-top-chrome-inner">
        <Link href="/" className="rv-public-wordmark rv-top-chrome-wordmark">
          Retroverse
        </Link>
        {back ? (
          <Link href={back.href} className="rv-top-chrome-back">
            ← {back.label}
          </Link>
        ) : (
          <span className="rv-top-chrome-spacer" aria-hidden />
        )}
      </div>
    </header>
  );
}
