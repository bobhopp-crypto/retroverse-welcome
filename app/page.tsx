import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Retroscope · Retroverse",
  description: "Year × rank handheld navigator into the archive.",
};

/** Primary entry: handheld RetroScope (no extra chrome on this hop). */
export default function HomePage() {
  permanentRedirect("/album-retroscope");
}
