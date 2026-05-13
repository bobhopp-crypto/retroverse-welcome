"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/ops/review", label: "Review" },
  { href: "/ops/itunes-album-review", label: "iTunes" },
] as const;

export function OpsHeaderTabs() {
  const pathname = usePathname() ?? "";

  return (
    <div className="flex items-center gap-1 border-l border-[var(--card-border)]/35 pl-2 sm:pl-3" aria-label="Operations">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "rounded px-2 py-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--accent-primary)]"
                : "rounded px-2 py-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/85 transition hover:text-[var(--text-primary)]"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
