import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./retroverse-v3.css";

export const metadata: Metadata = {
  title: "Retroscope · Retroverse",
  description: "Temporal music-navigation instrument — signal field, observation window, tuned entity.",
};

export default function RetroverseV3Layout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
