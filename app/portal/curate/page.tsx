import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Curator · Retroverse",
  description: "Replace artwork with a chosen candidate.",
};

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

// Legacy entry point — every long-press / right-click handler now targets
// /portal-v2/curate. We keep this URL alive so stale tabs, bookmarks, and
// cached client chunks land on the v2 curator instead of the old UI.
export default async function PortalCurateLegacyRedirect({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const albumId = firstString(sp.albumId)?.trim() ?? "";
  const target = albumId
    ? `/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`
    : "/portal-v2";
  redirect(target);
}
