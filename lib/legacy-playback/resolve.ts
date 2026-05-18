import { createClient } from "@/lib/supabase";

import {
  getPlaybackSourceBundle,
  mergeVideoCache,
  resolveTrackPlayback,
  trackPlaybackKey,
  type PlaybackTrackInput,
} from "./playback";
import { playbackToSourceType, resolveTrackPlayButton } from "./track-play-button-state";
import type { LegacyPlaybackResolveInput, LegacyPlaybackResolveResult } from "./types";
import { loadLegacyVideoCache } from "./video-cache";

const RVTR_RE = /^RVTR[0-9]{6}$/i;

async function resolveArtistTitleFromRvtr(
  rvtr: string,
): Promise<{ artist: string; title: string } | null> {
  const supabase = createClient();
  const trackResult = await supabase
    .from("retroverse_tracks")
    .select("canonical_title, retroverse_artist_id")
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
    title: (trackResult.data.canonical_title ?? "").trim(),
    artist: (artistResult.data?.canonical_artist_name ?? "").trim() || "—",
  };
}

function cacheHitForKey(
  cache: Record<string, unknown>,
  artist: string,
  title: string,
): boolean {
  const key = trackPlaybackKey(artist, title);
  if (!key) return false;
  if (cache[key]) return true;
  const normTitle = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const compactTitle = normTitle.replace(/\s+/g, "");
  const compactArtist = artist
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  if (compactArtist && compactTitle) {
    const slugKey = `${compactArtist}__${compactTitle}`;
    if (cache[slugKey]) return true;
  }
  return false;
}

/**
 * Legacy music-browser playback bridge: R2 → YouTube → search.
 * Accepts artist+title; optional RVTR loads canonical names from Supabase first.
 */
export async function resolveLegacyPlayback(opts: {
  artist?: string;
  title?: string;
  rvtr?: string;
}): Promise<LegacyPlaybackResolveResult> {
  let artist = (opts.artist ?? "").trim();
  let title = (opts.title ?? "").trim();
  let retroverseTrackId: string | null = null;

  if (opts.rvtr?.trim()) {
    const id = opts.rvtr.trim().toUpperCase();
    if (!RVTR_RE.test(id)) {
      throw new Error("invalid_rvtr");
    }
    retroverseTrackId = id;
    const fromDb = await resolveArtistTitleFromRvtr(id);
    if (!fromDb) {
      throw new Error("rvtr_not_found");
    }
    artist = fromDb.artist;
    title = fromDb.title;
  }

  if (!artist || !title) {
    throw new Error("artist_and_title_required");
  }

  const { cache, loadedFrom, entryCount } = await loadLegacyVideoCache();

  const trackInput: PlaybackTrackInput = { artist, title };
  const merged = mergeVideoCache(trackInput, cache);
  const bundle = getPlaybackSourceBundle(merged);
  const target = resolveTrackPlayback(trackInput, cache);
  const playButton = resolveTrackPlayButton(target, { allowInteraction: true });

  return {
    input: { artist, title, retroverseTrackId },
    playbackKey: trackPlaybackKey(artist, title),
    cacheHit: cacheHitForKey(cache, artist, title),
    cacheLoadedFrom: loadedFrom,
    cacheEntryCount: entryCount,
    sources: bundle.sources,
    target,
    sourceType: playbackToSourceType(target),
    playButton,
    merged: {
      video_url: merged.video_url ?? undefined,
      youtube_id: merged.youtube_id ?? undefined,
      thumbnail: merged.thumbnail ?? null,
      play_count: merged.play_count,
    },
  };
}
