import TrackDeckClient from "./track-deck-client";
import { hot100SqlitePath } from "@/lib/track-deck/constants";
import { enrichTrackDeckWeekPlayback } from "@/lib/track-deck/playback-enrich";
import { loadTrackDeckWeek, loadTrackDeckWeekIndex } from "@/lib/track-deck/queries";
import type { TrackDeckWeekIndex, TrackDeckWeekPayload } from "@/lib/track-deck/types";
import { readTrackLinkIndex } from "@/lib/track-links";

export const dynamic = "force-dynamic";

export default async function TrackDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const requestedDate =
    typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date.trim())
      ? sp.date.trim()
      : null;

  let dbError: string | null = null;
  let initialIndex: TrackDeckWeekIndex | null = null;
  let initialWeek: TrackDeckWeekPayload | null = null;

  const year = requestedDate
    ? Number.parseInt(requestedDate.slice(0, 4), 10)
    : 1977;

  let linkedKeys: string[] = [];
  try {
    linkedKeys = [...(await readTrackLinkIndex()).keys()];
    initialIndex = loadTrackDeckWeekIndex(year);
    const pick =
      requestedDate && initialIndex.weeksForYear.includes(requestedDate)
        ? requestedDate
        : (initialIndex.weeksForYear[Math.floor(initialIndex.weeksForYear.length / 2)] ?? null);
    if (pick) {
      const raw = loadTrackDeckWeek(pick);
      if (raw) initialWeek = await enrichTrackDeckWeekPlayback(raw);
    }
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  return (
    <TrackDeckClient
      sqlitePath={hot100SqlitePath()}
      initialDate={initialWeek?.week.issueDate ?? requestedDate}
      initialYear={year}
      initialIndex={initialIndex}
      initialWeek={initialWeek}
      linkedKeys={linkedKeys}
      dbError={dbError}
    />
  );
}
