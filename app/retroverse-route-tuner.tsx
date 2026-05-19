"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CHAMBER_LABELS = [
  { test: (path: string) => path.startsWith("/portal-v2"), label: "Tuning culture portal" },
  { test: (path: string) => path.includes("retroscope"), label: "Entering memory grid" },
  { test: (path: string) => path.startsWith("/search"), label: "Finding the signal" },
  { test: (path: string) => path.startsWith("/albums"), label: "Opening record sleeve" },
  { test: (path: string) => path.startsWith("/artists"), label: "Following artist frequency" },
  { test: (path: string) => path.startsWith("/tracks"), label: "Cueing chart memory" },
] as const;

function chamberLabel(pathname: string): string {
  return CHAMBER_LABELS.find((item) => item.test(pathname))?.label ?? "Tuning Retroverse";
}

export default function RetroverseRouteTuner() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setActiveLabel(chamberLabel(pathname));
    const timer = window.setTimeout(() => setActiveLabel(null), 760);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (!activeLabel) return null;

  return (
    <div className="rv-route-tuner" aria-hidden="true">
      <div className="rv-route-tuner__beam" />
      <div className="rv-route-tuner__plate">
        <span className="rv-route-tuner__dial" />
        <span>{activeLabel}</span>
      </div>
    </div>
  );
}
