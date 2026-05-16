import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { discoverStableAlbumRowFromLocalDossier } from "@/lib/curator-album-local";
import { validateAlbumRowForCurator } from "@/lib/curator-album-metadata";

import PortalV2CurateClient from "./portal-v2-curate-client";
import CuratorAlbumResolveError from "./curator-metadata-error";

export const metadata: Metadata = {
  title: "Curator · Retroverse",
  description: "Choose cover art for this album.",
};

export const dynamic = "force-dynamic";

const RVAL = /^RVAL[0-9]{6}$/;

type Search = Record<string, string | string[] | undefined>;

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function PortalV2CuratePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const raw = firstString(sp.albumId)?.trim().toUpperCase() ?? "";
  if (!RVAL.test(raw)) redirect("/portal-v2");

  /** Dossiers + canonical artwork overlays (no Supabase). */
  const row = await discoverStableAlbumRowFromLocalDossier(raw);
  if (!row || row.kind !== "album") redirect("/portal-v2");

  const meta = validateAlbumRowForCurator(row);
  console.log("[portal-v2/curate] metadata resolution", {
    albumId: raw,
    resolvedArtist: row.artist,
    resolvedTitle: row.title,
    resolvedYear: row.year,
    validationOk: meta.ok,
    issues: meta.ok ? undefined : meta.issues,
    discogsQueryPreview: `"${collapseForLog(row.artist)} ${collapseForLog(row.title)}"`,
  });

  if (!meta.ok) {
    return (
      <CuratorAlbumResolveError albumId={raw} issues={meta.issues} title={row.title} artist={row.artist} year={row.year} />
    );
  }

  return <PortalV2CurateClient key={raw} row={row} />;
}

function collapseForLog(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}
