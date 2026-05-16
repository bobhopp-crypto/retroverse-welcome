"use client";

import Link from "next/link";

const LOFT_ITEMS: [string, string][] = [
  ["/albums", "Albums"],
  ["/eras", "Eras"],
  ["/artists", "Artists"],
  ["/search", "Search"],
  ["/site-index", "Index"],
];

export default function PortalLoftNav() {
  return (
    <details className="fixed right-[max(0.65rem,env(safe-area-inset-right))] top-[max(0.52rem,calc(env(safe-area-inset-top)+10px))] z-[60] sm:right-6">
      <summary className="list-none cursor-pointer rounded-md border border-[rgba(201,168,108,0.22)] bg-[rgba(8,10,16,0.82)] px-2 py-[0.22rem] text-[12px] font-medium tracking-[0.14em] text-[#c4b89d] uppercase backdrop-blur-[10px] select-none [&::-webkit-details-marker]:hidden">
        menu
      </summary>
      <nav
        className="absolute right-0 z-[61] mt-1.5 flex min-w-[10rem] flex-col rounded-[10px] border border-[rgba(201,168,108,0.14)] bg-[rgba(6,8,14,0.96)] px-1 py-1.5 text-left shadow-[0_18px_48px_-18px_rgba(0,0,0,0.9)] backdrop-blur-md"
        aria-label="Shortcuts"
      >
        {LOFT_ITEMS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="rounded-md px-2.5 py-1.5 text-[13px] text-[#dfd5c8] hover:bg-[rgba(201,168,108,0.08)] hover:text-[#faf6ef]"
          >
            {label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
