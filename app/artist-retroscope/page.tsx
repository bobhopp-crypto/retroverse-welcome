import type { Metadata } from "next";

import { loadArtistRetroscopeDataset } from "@/lib/load-artist-retroscope-dataset";

import RetroscopeClient from "../album-retroscope/album-retroscope-client";

export const metadata: Metadata = {
  title: "Artist Retroscope",
  description: "Spatial year × Retroverse artist rank exploration.",
};

export const dynamic = "force-dynamic";

export default async function ArtistRetroscopePage() {
  let data: Awaited<ReturnType<typeof loadArtistRetroscopeDataset>> = null;
  try {
    data = await loadArtistRetroscopeDataset();
  } catch (e) {
    console.error("[artist-retroscope:page]", "load failed", e);
    data = null;
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="arv-root arv-root--empty px-4 text-center text-[rgba(236,220,200,0.55)]">
        <p className="text-sm tracking-[0.2em] uppercase">Artist Retroscope</p>
        <p className="mt-4 text-base text-[var(--text-primary,#ece6dc)]">
          Artist rankings corpus is empty. Run{" "}
          <code className="text-[0.85em]">npm run generate:artist-year-rankings</code> then{" "}
          <code className="text-[0.85em]">npm run generate:artist-universe</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="arv-root">
      <RetroscopeClient
        mode="artist"
        cells={data.cells}
        initialActiveKey={data.initialActiveKey}
        corpusId={data.corpusId}
      />
    </div>
  );
}
