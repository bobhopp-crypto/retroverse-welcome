import { Cormorant_Garamond } from "next/font/google";
import type { ReactNode } from "react";

import "./portal-stage.css";

const stageSerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-stage-serif",
  display: "swap",
});

/** Clean-room shell: single fixed viewport layer; children only inside. */
export default function PortalStageLayout({ children }: { children: ReactNode }) {
  return <div className={`portal-stage-outer ${stageSerif.variable}`}>{children}</div>;
}
