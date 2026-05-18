import path from "node:path";

import { checkPlaybackForFile } from "./playback-check";
import { searchVdjDatabaseXml } from "./search-vdj-xml";
import type { PlaybackCheck } from "./playback-check";
import {
  classifyVdjPath,
  type VdjMediaKind,
  videoFormatFromPath,
  type VideoFormat,
} from "./vdj-media";

export type VdjFileRow = {
  filePath: string;
  fileName: string;
  score: number;
  mediaKind: VdjMediaKind;
  videoFormat: VideoFormat | null;
  playback: PlaybackCheck;
};

export type LinkWorkspacePayload = {
  ok: true;
  source: {
    artist: string;
    title: string;
    chartWeek: string | null;
    chartRank: number | null;
  };
  files: VdjFileRow[];
};

export type LinkWorkspaceQuery = {
  artist?: string;
  title?: string;
  chartWeek?: string;
  chartRank?: string;
};

export async function loadLinkWorkspace(
  query: LinkWorkspaceQuery,
): Promise<LinkWorkspacePayload | { ok: false; error: string }> {
  const artist = query.artist?.trim() ?? "";
  const title = query.title?.trim() ?? "";
  if (!artist || !title) {
    return { ok: false, error: "artist_and_title_required" };
  }

  const chartRankRaw = query.chartRank?.trim();
  const chartRank = chartRankRaw ? Number.parseInt(chartRankRaw, 10) : null;

  const source = {
    artist,
    title,
    chartWeek: query.chartWeek?.trim() || null,
    chartRank: Number.isFinite(chartRank) ? chartRank : null,
  };

  const vdjResult = await searchVdjDatabaseXml({ artist, title, limit: 24 });

  const files: VdjFileRow[] = await Promise.all(
    vdjResult.entries.map(async (entry) => {
      const mediaKind =
        "mediaKind" in entry && entry.mediaKind
          ? (entry.mediaKind as VdjMediaKind)
          : classifyVdjPath(entry.filePath);
      const playback = await checkPlaybackForFile({
        chartArtist: artist,
        chartTitle: title,
        vdjArtist: entry.artist,
        vdjTitle: entry.title,
        vdjFilePath: entry.filePath,
      });
      return {
        filePath: entry.filePath,
        fileName: path.basename(entry.filePath),
        score: entry.score,
        mediaKind,
        videoFormat: videoFormatFromPath(entry.filePath),
        playback,
      };
    }),
  );

  files.sort((a, b) => {
    if (a.mediaKind !== b.mediaKind) {
      if (a.mediaKind === "video") return -1;
      if (b.mediaKind === "video") return 1;
    }
    return b.score - a.score;
  });

  return { ok: true, source, files };
}
