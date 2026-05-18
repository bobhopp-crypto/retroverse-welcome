import type { HomeSearchPayload } from "./types";

/** Client-safe: normalize API JSON without importing server search loaders. */
export function normalizeHomeSearchPayload(raw: unknown, q: string): HomeSearchPayload {
  const empty: HomeSearchPayload = { ok: true, q, tracks: [], albums: [], artists: [], charts: [] };
  if (!raw || typeof raw !== "object") return empty;

  const body = raw as Record<string, unknown>;
  const tracks = Array.isArray(body.tracks) ? body.tracks.filter((r) => r && typeof r === "object") : [];
  const albums = Array.isArray(body.albums) ? body.albums.filter((r) => r && typeof r === "object") : [];
  const artists = Array.isArray(body.artists) ? body.artists.filter((r) => r && typeof r === "object") : [];
  const charts = Array.isArray(body.charts) ? body.charts.filter((r) => r && typeof r === "object") : [];

  return {
    ok: true,
    q: typeof body.q === "string" ? body.q : q,
    tracks: tracks as HomeSearchPayload["tracks"],
    albums: albums as HomeSearchPayload["albums"],
    artists: artists as HomeSearchPayload["artists"],
    charts: charts as HomeSearchPayload["charts"],
    incomplete: body.incomplete === true ? true : undefined,
  };
}
