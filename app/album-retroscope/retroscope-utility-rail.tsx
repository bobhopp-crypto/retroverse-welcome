"use client";

import Link from "next/link";

import { HistoryBackButton } from "@/app/history-back-button";
import { retroscopeRouteForMode, type RetroscopeMode } from "@/lib/retroscope-mode";

function RailLabel({ text }: { text: string }) {
  return (
    <span className="arv-rail-lbl" aria-hidden>
      {text}
    </span>
  );
}

type Props = {
  side: "left" | "right";
  mode: RetroscopeMode;
  mapOpen: boolean;
  curatorHref: string | null;
  onMapToggle: () => void;
};

export function RetroscopeUtilityRail({ side, mode, mapOpen, curatorHref, onMapToggle }: Props) {
  if (side === "left") {
    return (
      <nav className="arv-rail arv-rail--left" aria-label="Utilities">
        <HistoryBackButton className="arv-rail-btn" fallbackHref="/welcome" aria-label="Back">
          <RailLabel text="Back" />
        </HistoryBackButton>
        {curatorHref ? (
          <Link href={curatorHref} className="arv-rail-btn" aria-label="Curator">
            <RailLabel text="Curator" />
          </Link>
        ) : (
          <span className="arv-rail-btn arv-rail-btn--off" aria-disabled aria-label="Curator">
            <RailLabel text="Curator" />
          </span>
        )}
        <button
          type="button"
          className={`arv-rail-btn${mapOpen ? " arv-rail-btn--on" : ""}`}
          aria-pressed={mapOpen}
          aria-label="Map"
          onClick={onMapToggle}
        >
          <RailLabel text="Map" />
        </button>
      </nav>
    );
  }

  return (
    <nav className="arv-rail arv-rail--right" aria-label="Layers">
      <Link
        href={retroscopeRouteForMode("album")}
        className={`arv-rail-btn${mode === "album" && !mapOpen ? " arv-rail-btn--on" : ""}`}
        aria-current={mode === "album" && !mapOpen ? "page" : undefined}
        aria-label="Albums"
      >
        <RailLabel text="Albums" />
      </Link>
      <Link
        href={retroscopeRouteForMode("artist")}
        className={`arv-rail-btn${mode === "artist" && !mapOpen ? " arv-rail-btn--on" : ""}`}
        aria-current={mode === "artist" && !mapOpen ? "page" : undefined}
        aria-label="Artists"
      >
        <RailLabel text="Artists" />
      </Link>
      <Link
        href="/track-deck"
        className={`arv-rail-btn${mode === "track" ? " arv-rail-btn--on" : ""}`}
        aria-label="Charts"
      >
        <RailLabel text="Charts" />
      </Link>
    </nav>
  );
}
