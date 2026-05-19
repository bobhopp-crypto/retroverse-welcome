import { IntegrityExplorer } from "./integrity-explorer";
import { loadExplorerData } from "@/lib/integrity-console/queries";
import type { IntegrityView } from "@/lib/integrity-console/types";

export const dynamic = "force-dynamic";

function parseView(raw: string | undefined): IntegrityView {
  if (raw === "families" || raw === "variants" || raw === "relationships") return raw;
  return "artists";
}

export default async function IntegrityPage({
  searchParams,
}: {
  searchParams: Promise<{ artist?: string; family?: string; q?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const artistId = sp.artist ? Number(sp.artist) : null;
  const familyId = sp.family ? Number(sp.family) : null;
  const searchQ = typeof sp.q === "string" ? sp.q.trim() : "";
  const view = parseView(sp.view);

  const data = await loadExplorerData({
    artistId: artistId && !Number.isNaN(artistId) ? artistId : null,
    familyId: familyId && !Number.isNaN(familyId) ? familyId : null,
    searchQ,
    view,
  });

  return <IntegrityExplorer data={data} />;
}
