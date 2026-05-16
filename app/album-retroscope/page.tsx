import type { Metadata } from "next";

import { loadAlbumRetroscopeDataset } from "@/lib/load-album-retroscope-dataset";

import AlbumRetroscopeClient from "./album-retroscope-client";

export const metadata: Metadata = {
  title: "Album Retroscope",
  description: "Spatial year × Retroverse rank exploration prototype.",
};

/** File-backed corpus can change without a rebuild (local runtime JSON). */
export const dynamic = "force-dynamic";

export default async function AlbumRetroscopePage() {
  let data: Awaited<ReturnType<typeof loadAlbumRetroscopeDataset>> = null;
  try {
    data = await loadAlbumRetroscopeDataset();
  } catch (e) {
    console.error("[album-retroscope:page]", "load failed", e);
    data = null;
  }

  if (!data || data.cells.length === 0) {
    return (
      <div className="arv-root arv-root--empty px-4 text-center text-[rgba(236,220,200,0.55)]">
        <p className="text-sm tracking-[0.2em] uppercase">Retroscope</p>
        <p className="mt-4 text-base text-[var(--text-primary,#ece6dc)]">Retroscope seed corpus is empty or invalid.</p>
      </div>
    );
  }

  return (
    <div className="arv-root">
      <AlbumRetroscopeClient
        mode="album"
        cells={data.cells}
        initialActiveKey={data.initialActiveKey}
        corpusId={data.corpusId}
      />
    </div>
  );
}
