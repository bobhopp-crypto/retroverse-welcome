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

export function RetroscopeModeStrip({ active }: { active: RetroscopeMode }) {
  return (
    <nav className="arv-mode-strip" aria-label="RetroScope layer">
      {LAYERS.map(({ mode, label }) => (
        <Link
          key={mode}
          href={retroscopeRouteForMode(mode)}
          className={`arv-mode-btn${active === mode ? " arv-mode-btn--on" : ""}${mode === "track" ? " arv-mode-btn--stub" : ""}`}
          aria-current={active === mode ? "true" : undefined}
          onClick={() => saveRetroscopePreferredMode(mode)}
        >
          <span className="arv-mode-btn-led" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
