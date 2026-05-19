import { loadExplorerDataWithAlbums } from "@/lib/integrity-console/album-queries";
import type { IntegrityView } from "@/lib/integrity-console/types";

import { IntegrityExplorer } from "./integrity-explorer";

export const dynamic = "force-dynamic";

function parseView(raw: string | undefined): IntegrityView {
  if (
    raw === "families" ||
    raw === "variants" ||
    raw === "relationships" ||
    raw === "albums" ||
    raw === "b200" ||
    raw === "tracklists"
  ) {
    return raw;
  }
  return "artists";
}

export default async function IntegrityPage({
  searchParams,
}: {
  searchParams: Promise<{
    artist?: string;
    family?: string;
    album?: string;
    q?: string;
    view?: string;
  }>;
}) {
  const sp = await searchParams;
  const artistId = sp.artist ? Number(sp.artist) : null;
  const familyId = sp.family ? Number(sp.family) : null;
  const albumId = sp.album ? Number(sp.album) : null;
  const searchQ = typeof sp.q === "string" ? sp.q.trim() : "";
  const view = parseView(sp.view);

  const data = await loadExplorerDataWithAlbums({
    artistId: artistId && !Number.isNaN(artistId) ? artistId : null,
    familyId: familyId && !Number.isNaN(familyId) ? familyId : null,
    albumId: albumId && !Number.isNaN(albumId) ? albumId : null,
    searchQ,
    view,
  });

  return <IntegrityExplorer data={data} />;
}
