import { Cormorant, Inter } from "next/font/google";
import type { ReactNode } from "react";

import PortalImmersiveBody from "./portal-immersive-body";
import PortalLoftNav from "./portal-loft-nav";

const portalDisplay = Cormorant({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-portal-display",
  display: "swap",
});

const portalSans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-portal-sans",
  display: "swap",
});

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div
      data-portal-scope
      className={`${portalDisplay.variable} ${portalSans.variable} relative min-h-[calc(100dvh-var(--rv-header-offset))] overflow-x-hidden bg-[#05070c] text-[#ebe6dc]`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_85%_70%_at_50%_38%,rgba(28,38,52,0.55)_0%,rgba(8,10,16,0.92)_45%,rgba(2,3,8,1)_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_120%_90%_at_50%_50%,transparent_35%,rgba(0,0,0,0.55)_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[42%] z-0 bg-[radial-gradient(ellipse_80%_90%_at_50%_0%,rgba(201,168,108,0.09)_0%,transparent_65%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[var(--rv-header-offset)] bottom-0 z-0 opacity-100 shadow-[inset_0_0_80px_28px_rgba(0,0,0,0.45)]"
      />
      <div className="relative z-[1]">
        <PortalImmersiveBody />
        <PortalLoftNav />
        {children}
      </div>
    </div>
  );
}
