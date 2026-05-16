"use client";

import Link from "next/link";

import {
  retroscopeRouteForMode,
  type RetroscopeMode,
} from "@/lib/retroscope-mode";
import { saveRetroscopePreferredMode } from "@/lib/retroscope-mode-persist";

const LAYERS: { mode: RetroscopeMode; label: string }[] = [
  { mode: "album", label: "Albums" },
  { mode: "artist", label: "Artists" },
  { mode: "track", label: "Tracks" },
];

type RetroscopeModeStripProps = {
  active: RetroscopeMode;
  mapOpen?: boolean;
  onMapOpen?: () => void;
  /** Center control-deck layout (replaces D-pad). */
  variant?: "chrome" | "deck";
};

export function RetroscopeModeStrip({
  active,
  mapOpen = false,
  onMapOpen,
  variant = "chrome",
}: RetroscopeModeStripProps) {
  return (
    <nav
      className={`arv-mode-strip${variant === "deck" ? " arv-mode-strip--deck" : ""}`}
      aria-label="RetroScope layer"
    >
      {LAYERS.map(({ mode, label }) => (
        <Link
          key={mode}
          href={retroscopeRouteForMode(mode)}
          className={`arv-mode-btn${active === mode && !mapOpen ? " arv-mode-btn--on" : ""}${mode === "track" ? " arv-mode-btn--stub" : ""}`}
          aria-current={active === mode && !mapOpen ? "true" : undefined}
          onClick={() => saveRetroscopePreferredMode(mode)}
        >
          <span className="arv-mode-btn-led" aria-hidden />
          {label}
        </Link>
      ))}
      <button
        type="button"
        className={`arv-mode-btn arv-mode-btn--map${mapOpen ? " arv-mode-btn--on" : ""}`}
        aria-pressed={mapOpen}
        onClick={() => onMapOpen?.()}
      >
        <span className="arv-mode-btn-led" aria-hidden />
        Map
      </button>
    </nav>
  );
}
