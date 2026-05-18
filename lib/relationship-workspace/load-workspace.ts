import { createClient } from "@/lib/supabase";

import { formatPanelError, loadPanel } from "./panel-result";
import { searchAlbumPlacements, searchArtistCandidates } from "./search-albums-artists";
import { searchChartEntries } from "./search-charts";
import { searchR2MediaCandidates } from "./search-r2";
import { searchRvtrTracks } from "./search-rvtr";
import { searchVdjDatabaseXml } from "./search-vdj-xml";
import type { RelationshipWorkspacePayload, RelationshipWorkspaceSource } from "./types";

const RVTR_RE = /^RVTR[0-9]{6}$/i;

export type RelationshipWorkspaceQuery = {
  artist?: string;
  title?: string;
  rvtr?: string;
  vdjPath?: string;
  chartWeek?: string;
  chartRank?: string;
  q?: string;
};

function panelInput(source: RelationshipWorkspaceSource): Record<string, unknown> {
  return {
    artist: source.artist,
    title: source.title,
    rvtr: source.retroverseTrackId,
    vdjPath: source.vdjPath,
    chartWeek: source.chartWeek,
    chartRank: source.chartRank,
    q: source.freeText,
  };
}

async function resolveSourceFromRvtr(rvtr: string): Promise<Partial<RelationshipWorkspaceSource> | null> {
  try {
    const supabase = createClient();
    const trackResult = await supabase
      .from("retroverse_tracks")
      .select("canonical_title, retroverse_artist_id, retroverse_track_id")
      .eq("retroverse_track_id", rvtr.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (trackResult.error) throw trackResult.error;
    if (!trackResult.data) return null;

    const artistResult = await supabase
      .from("retroverse_artists")
      .select("canonical_artist_name")
      .eq("retroverse_artist_id", trackResult.data.retroverse_artist_id)
      .limit(1)
      .maybeSingle();
    if (artistResult.error) throw artistResult.error;

    return {
      artist: (artistResult.data?.canonical_artist_name ?? "").trim(),
      title: (trackResult.data.canonical_title ?? "").trim(),
      retroverseTrackId: trackResult.data.retroverse_track_id,
    };
  } catch (err) {
    console.warn(
      `[relationship-workspace] panel=source source=supabase-rvtr error=${formatPanelError(err)} rvtr=${rvtr}`,
    );
    return null;
  }
}

export function buildSourceFromQuery(
  query: RelationshipWorkspaceQuery,
): RelationshipWorkspaceSource | null {
  let artist = (query.artist ?? "").trim();
  let title = (query.title ?? "").trim();
  const rvtr = query.rvtr?.trim().toUpperCase() ?? null;
  const vdjPath = query.vdjPath?.trim() || null;

  if (vdjPath && (!artist || !title)) {
    const base = vdjPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const dash = base.indexOf(" - ");
    if (dash > 0) {
      if (!artist) artist = base.slice(0, dash).trim();
      if (!title) title = base.slice(dash + 3).trim();
    }
  }

  if (!artist && !title && !vdjPath && !(rvtr && RVTR_RE.test(rvtr))) {
    return null;
  }

  const chartRankRaw = query.chartRank?.trim();
  const chartRank = chartRankRaw ? Number.parseInt(chartRankRaw, 10) : null;

  return {
    artist: artist || "—",
    title: title || "—",
    retroverseTrackId: rvtr && RVTR_RE.test(rvtr) ? rvtr : null,
    chartWeek: query.chartWeek?.trim() || null,
    chartRank: Number.isFinite(chartRank) ? chartRank : null,
    vdjPath,
    freeText: query.q?.trim() || null,
  };
}

/** Never throws — always returns a payload when context can be derived. */
export async function loadRelationshipWorkspace(
  query: RelationshipWorkspaceQuery,
): Promise<RelationshipWorkspacePayload | { ok: false; error: string }> {
  try {
    let source = buildSourceFromQuery(query);
    if (!source) {
      return { ok: false, error: "Provide artist+title, rvtr, or vdjPath" };
    }

    const rvtr = source.retroverseTrackId;
    if (rvtr) {
      const fromRvtr = await resolveSourceFromRvtr(rvtr);
      if (fromRvtr) {
        if (fromRvtr.artist) source = { ...source, artist: fromRvtr.artist };
        if (fromRvtr.title) source = { ...source, title: fromRvtr.title };
        if (fromRvtr.retroverseTrackId) {
          source = { ...source, retroverseTrackId: fromRvtr.retroverseTrackId };
        }
      }
    }

    const input = panelInput(source);

    let vdjDatabasePath: string | null = null;
    const vdj = await loadPanel({
      panel: "vdj",
      source: "virtualdj-database.xml",
      input,
      emptyMessage: "No VDJ matches",
      unavailableMessage: "Unavailable",
      offlineMessage: "Source offline",
      run: async () => {
        const result = await searchVdjDatabaseXml({
          artist: source.artist,
          title: source.title,
          freeText: source.freeText ?? undefined,
          vdjPath: source.vdjPath,
        });
        vdjDatabasePath = result.path;
        if (!result.path) {
          throw new Error("VDJ database.xml not found (set VDJ_DATABASE_XML_PATH)");
        }
        return result.entries;
      },
      meta: {},
    }).then((panel) => ({ ...panel, meta: { databasePath: vdjDatabasePath } }));

    const [charts, rvtrPanel, albums, artists] = await Promise.all([
      loadPanel({
        panel: "charts",
        source: "hot100-sqlite",
        input,
        emptyMessage: "No results",
        unavailableMessage: "Unavailable",
        offlineMessage: "Source offline",
        run: async () => searchChartEntries({ artist: source.artist, title: source.title }),
      }),
      loadPanel({
        panel: "rvtr",
        source: "supabase-optional",
        input,
        emptyMessage: "No results",
        unavailableMessage: "Unavailable",
        offlineMessage: "Source offline",
        run: async () =>
          searchRvtrTracks({
            artist: source.artist,
            title: source.title,
            rvtr: source.retroverseTrackId,
          }),
      }),
      loadPanel({
        panel: "albums",
        source: "supabase-optional",
        input,
        emptyMessage: "No results",
        unavailableMessage: "Unavailable",
        offlineMessage: "Source offline",
        run: async () => searchAlbumPlacements({ artist: source.artist, title: source.title }),
      }),
      loadPanel({
        panel: "artists",
        source: "supabase-optional",
        input,
        emptyMessage: "No results",
        unavailableMessage: "Unavailable",
        offlineMessage: "Source offline",
        run: async () => searchArtistCandidates({ artist: source.artist }),
      }),
    ]);

    const topVdj = vdj.items[0]?.filePath ?? source.vdjPath;
    const r2 = await loadPanel({
      panel: "r2",
      source: "legacy-video_lookup",
      input: { ...input, topVdjPath: topVdj },
      emptyMessage: "No playback candidate",
      unavailableMessage: "Unavailable",
      offlineMessage: "Source offline",
      run: async () =>
        searchR2MediaCandidates({
          artist: source.artist,
          title: source.title,
          rvtr: source.retroverseTrackId,
          topVdjPath: topVdj,
        }),
    });

    return {
      ok: true,
      source,
      vdjDatabasePath,
      charts,
      rvtr: rvtrPanel,
      albums,
      artists,
      vdj,
      r2,
    };
  } catch (err) {
    const error = formatPanelError(err);
    console.error(`[relationship-workspace] load fatal error=${error}`);
    const fallback = buildSourceFromQuery(query);
    if (!fallback) {
      return { ok: false, error };
    }
    const input = panelInput(fallback);
    return emptyWorkspacePayload(fallback, error);
  }
}

export function emptyWorkspacePayload(
  source: RelationshipWorkspaceSource,
  error?: string,
): RelationshipWorkspacePayload {
  const dead = (panel: string, sourceName: string) => ({
    status: "unavailable" as const,
    source: sourceName,
    items: [],
    message: "Unavailable",
    error: error ?? null,
  });
  return {
    ok: true,
    source,
    vdjDatabasePath: null,
    charts: dead("charts", "hot100-sqlite"),
    rvtr: dead("rvtr", "supabase-optional"),
    albums: dead("albums", "supabase-optional"),
    artists: dead("artists", "supabase-optional"),
    vdj: dead("vdj", "virtualdj-database.xml"),
    r2: dead("r2", "legacy-video_lookup"),
  };
}
