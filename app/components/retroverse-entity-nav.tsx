import Link from "next/link";

import type { NavItem } from "@/lib/retroverse-nav";

type Props = {
  back?: NavItem;
  items?: NavItem[];
  className?: string;
};

export function RetroverseEntityNav({ back, items = [], className = "" }: Props) {
  if (!back && items.length === 0) return null;

  return (
    <nav
      className={`rv-entity-nav flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[0.68rem] uppercase tracking-[0.14em] ${className}`.trim()}
      aria-label="Page navigation"
    >
      {back ? (
        <Link href={back.href} className="rv-entity-nav-back shrink-0 text-[var(--text-secondary)] hover:text-[var(--accent-primary)]">
          ← {back.label}
        </Link>
      ) : null}
      {back && items.length > 0 ? (
        <span className="text-[var(--card-border)]" aria-hidden>
          |
        </span>
      ) : null}
      {items.map((item) => (
        <Link
          key={`${item.href}:${item.label}`}
          href={item.href}
          className="rv-entity-nav-link text-[var(--text-secondary)] hover:text-[var(--accent-primary)]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
