"use client";

import Link from "next/link";

import { retroscopeRouteForMode, type RetroscopeMode } from "@/lib/retroscope-mode";

function RailIcon({ name }: { name: "exit" | "curator" | "map" | "albums" | "artists" | "charts" }) {
  const common = { viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const };
  switch (name) {
    case "exit":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <path d="M9 5H5v14h4M11 12h8M15 9l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "curator":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="8" r="3.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 19c0-3.3 2.7-5 6-5s6 1.7 6 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "map":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <path d="M5 7l6-2 8 2v12l-8-2-6 2V7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M11 5v12M19 7v12" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "albums":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="7.25" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      );
    case "artists":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="9" r="3.25" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.5 19c.6-2.8 3-4.5 6.5-4.5s5.9 1.7 6.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "charts":
      return (
        <svg {...common} xmlns="http://www.w3.org/2000/svg">
          <path d="M6 17V11M12 17V7M18 17v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      );
  }
}

type RetroscopeUtilityRailProps = {
  side: "left" | "right";
  mode: RetroscopeMode;
  mapOpen: boolean;
  curatorHref: string | null;
  onMapToggle: () => void;
};

export function RetroscopeUtilityRail({
  side,
  mode,
  mapOpen,
  curatorHref,
  onMapToggle,
}: RetroscopeUtilityRailProps) {
  if (side === "left") {
    return (
      <nav className="arv-utility-rail arv-utility-rail--left" aria-label="Retroscope utilities">
        <Link href="/welcome" className="arv-utility-btn">
          <RailIcon name="exit" />
          <span className="arv-utility-label">Exit</span>
        </Link>
        {curatorHref ? (
          <Link href={curatorHref} className="arv-utility-btn">
            <RailIcon name="curator" />
            <span className="arv-utility-label">Curator</span>
          </Link>
        ) : (
          <span className="arv-utility-btn arv-utility-btn--disabled" aria-disabled>
            <RailIcon name="curator" />
            <span className="arv-utility-label">Curator</span>
          </span>
        )}
        <button
          type="button"
          className={`arv-utility-btn${mapOpen ? " arv-utility-btn--on" : ""}`}
          aria-pressed={mapOpen}
          onClick={onMapToggle}
        >
          <RailIcon name="map" />
          <span className="arv-utility-label">Map</span>
        </button>
      </nav>
    );
  }

  return (
    <nav className="arv-utility-rail arv-utility-rail--right" aria-label="Retroscope layers">
      <Link
        href={retroscopeRouteForMode("album")}
        className={`arv-utility-btn${mode === "album" && !mapOpen ? " arv-utility-btn--on" : ""}`}
        aria-current={mode === "album" && !mapOpen ? "page" : undefined}
      >
        <RailIcon name="albums" />
        <span className="arv-utility-label">Albums</span>
      </Link>
      <Link
        href={retroscopeRouteForMode("artist")}
        className={`arv-utility-btn${mode === "artist" && !mapOpen ? " arv-utility-btn--on" : ""}`}
        aria-current={mode === "artist" && !mapOpen ? "page" : undefined}
      >
        <RailIcon name="artists" />
        <span className="arv-utility-label">Artists</span>
      </Link>
      <Link
        href="/track-deck"
        className={`arv-utility-btn${mode === "track" && !mapOpen ? " arv-utility-btn--on" : ""}`}
        aria-current={mode === "track" ? "page" : undefined}
      >
        <RailIcon name="charts" />
        <span className="arv-utility-label">Charts</span>
      </Link>
    </nav>
  );
}
