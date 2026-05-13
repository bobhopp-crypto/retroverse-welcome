import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { hydrateDiscoverAlbumRows } from "@/lib/discover-hydrate-rows";

import PortalCurateClient from "./portal-curate-client";

export const metadata: Metadata = {
  title: "Curator · Portal · Retroverse",
  description: "Replace artwork with a chosen candidate.",
};

export const dynamic = "force-dynamic";

const RVAL = /^RVAL[0-9]{6}$/;

type Search = Record<string, string | string[] | undefined>;

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export default async function PortalCuratePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const raw = firstString(sp.albumId)?.trim().toUpperCase() ?? "";
  if (!RVAL.test(raw)) redirect("/portal");

  const rows = await hydrateDiscoverAlbumRows([raw]);
  const row = rows.find((r) => r.kind === "album" && r.albumId === raw);
  if (!row || row.kind !== "album") redirect("/portal");

  return <PortalCurateClient row={row} />;
}
