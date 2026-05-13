import { Cormorant_Garamond, Inter } from "next/font/google";
import type { ReactNode } from "react";

import "./v2.css";

import PortalViewportLock from "./portal-viewport-lock";

const pv2Display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-pv2-display",
  display: "swap",
});

const pv2Sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-pv2-sans",
  display: "swap",
});

/** Shared portal shell: fonts, atmosphere, and viewport fill (used by `/` and `/portal-v2`). */
export default function PortalAtmosphere({ children }: { children: ReactNode }) {
  return (
    <div
      className={`pv2-root ${pv2Display.variable} ${pv2Sans.variable} relative flex h-[100dvh] max-h-[100dvh] min-h-0 flex-1 flex-col overflow-hidden text-[var(--pv2-ink,#f0e6d2)]`}
    >
      <PortalViewportLock />
      <div aria-hidden className="pv2-atmo-base pointer-events-none absolute inset-0 z-0" />
      <div aria-hidden className="pv2-atmo-vignette pointer-events-none absolute inset-0 z-0" />
      <div aria-hidden className="pv2-atmo-grid pointer-events-none absolute inset-0 z-0" />
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
