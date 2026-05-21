"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { TRANSPORT_NAV, transportItemActive, transportNavVisible } from "@/lib/transport-nav";

export function RetroverseTransportDeck() {
  const pathname = usePathname() ?? "/";
  if (!transportNavVisible(pathname)) return null;

  return (
    <nav className="rv-transport-deck" aria-label="Retroverse transport">
      <div className="rv-transport-deck-rail">
        <ul className="rv-transport-deck-list">
          {TRANSPORT_NAV.map((item, index) => {
            const active = transportItemActive(pathname, item.href);
            return (
              <li key={item.href} className="rv-transport-deck-item">
                {index > 0 ? <span className="rv-transport-deck-sep" aria-hidden /> : null}
                <Link
                  href={item.href}
                  className={`rv-transport-deck-etch${active ? " rv-transport-deck-etch--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="rv-transport-deck-glyph" aria-hidden>
                    {item.glyph}
                  </span>
                  <span className="rv-transport-deck-label">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
