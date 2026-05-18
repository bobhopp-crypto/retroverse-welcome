import RelationshipWorkspaceClient from "./relationship-workspace-client";
import { loadLinkWorkspace } from "@/lib/relationship-workspace/load-link-workspace";

export const dynamic = "force-dynamic";

export default async function RelationshipWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    artist?: string;
    title?: string;
    chartWeek?: string;
    chartRank?: string;
  }>;
}) {
  const sp = await searchParams;
  const query = {
    artist: sp.artist,
    title: sp.title,
    chartWeek: sp.chartWeek,
    chartRank: sp.chartRank,
  };

  const hasContext = Boolean(sp.artist?.trim() && sp.title?.trim());

  let initial = null;
  let shellError: string | null = null;

  if (hasContext) {
    try {
      const result = await loadLinkWorkspace(query);
      if (result.ok) {
        initial = result;
      } else {
        shellError = result.error;
      }
    } catch (e) {
      shellError = e instanceof Error ? e.message : String(e);
      console.warn(`[link-workspace] page error=${shellError}`);
    }
  }

  return (
    <RelationshipWorkspaceClient
      initial={initial}
      shellError={shellError}
      hasContext={hasContext}
    />
  );
}
