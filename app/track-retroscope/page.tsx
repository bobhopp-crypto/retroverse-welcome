import type { Metadata } from "next";

import { loadTrackRetroscopeDataset } from "@/lib/load-track-retroscope-dataset";

import RetroscopeClient from "../album-retroscope/album-retroscope-client";

export const metadata: Metadata = {
  title: "Track Retroscope",
  description: "Spatial year × Hot 100 rank exploration (placeholder).",
};

export const dynamic = "force-dynamic";

export default async function TrackRetroscopePage() {
  let data: Awaited<ReturnType<typeof loadTrackRetroscopeDataset>> = null;
  try {
    data = await loadTrackRetroscopeDataset();
  } catch (e) {
    console.error("[track-retroscope:page]", "load failed", e);
    data = null;
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="arv-root arv-root--empty px-4 text-center text-[rgba(236,220,200,0.55)]">
        <p className="text-sm tracking-[0.2em] uppercase">Track Retroscope</p>
        <p className="mt-4 text-base text-[var(--text-primary,#ece6dc)]">
          Track ranking corpus not ready. Album stub unavailable.
        </p>
      </div>
    );
  }

  return (
    <div className="arv-root">
      <RetroscopeClient
        mode="track"
        cells={data.cells}
        initialActiveKey={data.initialActiveKey}
        corpusId={data.corpusId}
      />
    </div>
  );
}
