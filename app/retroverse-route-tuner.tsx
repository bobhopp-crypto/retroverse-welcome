"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Internal/lab routes only — public entity pages stay quiet. */
const INTERNAL_PREFIXES = [
  "/integrity",
  "/portal-v2",
  "/portal",
  "/portal-stage",
  "/relationship-workspace",
  "/track-curator",
  "/track-deck",
  "/dev-index",
  "/album-retroscope",
  "/chart-inspector",
] as const;

function isInternalPath(pathname: string): boolean {
  return INTERNAL_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

const CHAMBER_LABELS = [
  { test: (path: string) => path.startsWith("/portal-v2"), label: "Portal" },
  { test: (path: string) => path.includes("retroscope"), label: "Retroscope" },
  { test: (path: string) => path.startsWith("/integrity"), label: "Integrity" },
] as const;

function chamberLabel(pathname: string): string {
  return CHAMBER_LABELS.find((item) => item.test(pathname))?.label ?? "Loading";
}

export default function RetroverseRouteTuner() {
  const pathname = usePathname();
  const previousPath = useRef(pathname);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!isInternalPath(pathname)) {
      setActiveLabel(null);
      previousPath.current = pathname;
      return;
    }
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setActiveLabel(chamberLabel(pathname));
    const timer = window.setTimeout(() => setActiveLabel(null), 760);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  if (!activeLabel || !isInternalPath(pathname)) return null;

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
