import TrackCuratorClient from "./track-curator-client";
import { loadChartTrackContext } from "@/lib/track-curator/load-track";
import { suggestVdjFiles } from "@/lib/track-curator/vdj-match";

export const dynamic = "force-dynamic";

export default async function TrackCuratorPage({
  searchParams,
}: {
  searchParams: Promise<{ rvtr?: string; artist?: string; title?: string }>;
}) {
  const sp = await searchParams;
  const rvtr = typeof sp.rvtr === "string" ? sp.rvtr.trim() : "";
  const artistQ = typeof sp.artist === "string" ? sp.artist.trim() : "";
  const titleQ = typeof sp.title === "string" ? sp.title.trim() : "";

  let error: string | null = null;
  let track = null as Awaited<ReturnType<typeof loadChartTrackContext>>;
  let suggestions: Awaited<ReturnType<typeof suggestVdjFiles>> = [];

  try {
    track = await loadChartTrackContext({ rvtr, artist: artistQ, title: titleQ });
    if (track) {
      suggestions = await suggestVdjFiles({
        artist: track.artist,
        title: track.title,
        limit: 16,
      });
    } else {
      error = "Provide ?rvtr=RVTR###### or ?artist=…&title=…";
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <TrackCuratorClient
      track={track}
      suggestions={suggestions}
      error={error}
      initialRvtr={rvtr || track?.retroverseTrackId || null}
    />
  );
}
