/**
 * Retroverse album coverage audit — live DB counts only.
 * Run: npx tsx scripts/audit_album_coverage.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Pool } from "pg";

const WORKSPACE = process.cwd();
const OUT_MD = path.join(WORKSPACE, "docs/retroverse_album_coverage_audit.md");
const PAGE = 1000;

const VARIANT_RE =
  /\b(live|remaster(?:ed)?|mono|stereo|demo|session|sessions|rough|roughs|outtake|outtakes|alternate|version|edit|mix|acoustic|instrumental|karaoke|reprise|bonus|deluxe|expanded)\b/i;

function loadEnvLocal() {
  const raw = readFileSync(path.join(WORKSPACE, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function paginate<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  filter?: (q: ReturnType<SupabaseClient["from"]>) => ReturnType<SupabaseClient["from"]>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = supabase.from(table).select(select);
    if (filter) q = filter(q) as typeof q;
    let data: unknown[] | null = null;
    let lastErr = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await q.range(from, from + PAGE - 1);
      if (!res.error) {
        data = res.data ?? [];
        break;
      }
      lastErr = res.error.message;
      if (!/schema cache/i.test(lastErr)) throw new Error(table + ": " + lastErr);
      await sleep(800 * (attempt + 1));
    }
    if (!data) throw new Error(table + ": " + lastErr);
    const rows = data as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function fetchTracksByIds(sb: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 120) {
    const chunk = ids.slice(i, i + 120);
    const { data, error } = await sb.from("retroverse_tracks").select("retroverse_track_id, canonical_title").in("retroverse_track_id", chunk);
    if (error) throw new Error("retroverse_tracks chunk: " + error.message);
    for (const row of data ?? []) {
      const t = row as { retroverse_track_id: string; canonical_title: string };
      out.set(t.retroverse_track_id, t.canonical_title);
    }
  }
  return out;
}

function coverKind(p: string | null | undefined): string {
  const s = (p ?? "").trim();
  if (!s) return "missing";
  if (/^https?:\/\//i.test(s)) return "r2_http";
  return "path";
}

async function localPgRows(): Promise<{ ok: boolean; error?: string; metrics: Record<string, string> }> {
  try {
    const pool = new Pool({
      host: process.env.RETROVERSE_PG_HOST ?? "localhost",
      database: process.env.RETROVERSE_PG_DATABASE ?? "retroverse",
      user: process.env.RETROVERSE_PG_USER ?? "bobhopp",
      password: process.env.RETROVERSE_PG_PASSWORD ?? "",
      connectionTimeoutMillis: 4000,
    });
    const q = async (sql: string) => (await pool.query(sql)).rows[0] as Record<string, unknown>;
    const m: Record<string, string> = {};
    m.albums = String((await q("SELECT count(*)::int AS c FROM albums")).c);
    m.album_editions = String((await q("SELECT count(*)::int AS c FROM album_editions")).c);
    m.b200_albums = String(
      (await q("SELECT count(DISTINCT album_id)::int AS c FROM chart_appearances WHERE chart_name = 'Billboard 200' AND album_id IS NOT NULL")).c,
    );
    m.lineage_total = String((await q("SELECT count(*)::int AS c FROM album_track_lineage")).c);
    m.lineage_acoustics = String(
      (await q("SELECT count(*)::int AS c FROM album_track_lineage WHERE source_provenance = 'acoustics'")).c,
    );
    m.albums_with_lineage = String((await q("SELECT count(DISTINCT album_id)::int AS c FROM album_track_lineage")).c);
    m.ctal_total = String((await q("SELECT count(*)::int AS c FROM canonical_track_album_links")).c);
    m.ctal_acoustics = String(
      (await q("SELECT count(*)::int AS c FROM canonical_track_album_links WHERE source = 'acoustics'")).c,
    );
    await pool.end();
    return { ok: true, metrics: m };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), metrics: {} };
  }
}

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(2);
  }
  const sb = createClient(url, key);
  const generatedAt = new Date().toISOString();

  type Album = {
    retroverse_album_id: string;
    canonical_album_title: string;
    retroverse_artist_id: string;
    release_year: number | null;
    album_type: string;
    soundtrack_flag: boolean;
  };
  type Edition = { retroverse_album_edition_id: string; retroverse_album_id: string; is_primary: boolean; edition_name: string };
  type Art = {
    retroverse_album_id: string;
    canonical_cover_path: string | null;
    artwork_status: string | null;
    is_primary: boolean | null;
  };
  type AT = { retroverse_album_edition_id: string; retroverse_track_id: string };
  const albums = await paginate<Album>(
    sb,
    "retroverse_albums",
    "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, album_type, soundtrack_flag",
  );
  const editions = await paginate<Edition>(sb, "retroverse_album_editions", "retroverse_album_edition_id, retroverse_album_id, is_primary, edition_name");
  const artwork = await paginate<Art>(sb, "retroverse_album_artwork", "retroverse_album_id, canonical_cover_path, artwork_status, is_primary");
  const albumTracks = await paginate<AT>(sb, "retroverse_album_tracks", "retroverse_album_edition_id, retroverse_track_id");
  const chartRuns = await paginate<{ retroverse_album_id: string }>(sb, "canonical_album_chart_runs", "retroverse_album_id");

  const trackIds = [...new Set(albumTracks.map((r) => r.retroverse_track_id))];
  const titleByTrack = await fetchTracksByIds(sb, trackIds);

  let sourceMatches: { retroverse_entity_id: string; source: string }[] = [];
  try {
    sourceMatches = await paginate(sb, "retroverse_source_matches", "retroverse_entity_id, source", (q) =>
      q.eq("retroverse_entity_type", "album"),
    );
  } catch (e) {
    console.warn("retroverse_source_matches skipped:", e instanceof Error ? e.message : e);
  }

  const { count: chartRunRows } = await sb.from("canonical_album_chart_runs").select("*", { count: "exact", head: true });
  const localPg = await localPgRows();

  const dossierJson = JSON.parse(readFileSync(path.join(WORKSPACE, "public/data/albums/album-dossiers.json"), "utf8")) as {
    albums: Record<string, { acoustic?: { tracks?: { title: string }[] } }>;
  };
  const sequencesJson = JSON.parse(readFileSync(path.join(WORKSPACE, "public/data/albums/canonical-album-sequences.json"), "utf8")) as {
    sequences: Record<string, unknown>;
  };

  const primaryEd = new Map<string, string>();
  for (const e of editions) if (e.is_primary) primaryEd.set(e.retroverse_album_id, e.retroverse_album_edition_id);
  const edToAlbum = new Map(editions.map((e) => [e.retroverse_album_edition_id, e.retroverse_album_id]));

  const primaryTracks = new Map<string, string[]>();
  for (const row of albumTracks) {
    const albumId = edToAlbum.get(row.retroverse_album_edition_id);
    if (!albumId || primaryEd.get(albumId) !== row.retroverse_album_edition_id) continue;
    const list = primaryTracks.get(albumId) ?? [];
    list.push(titleByTrack.get(row.retroverse_track_id) ?? "");
    primaryTracks.set(albumId, list);
  }

  const b200 = new Set(chartRuns.map((r) => r.retroverse_album_id));
  const uniqueTitles = new Set(albums.map((a) => a.retroverse_artist_id + "::" + a.canonical_album_title.toLowerCase()));

  const withCover = new Set<string>();
  const withPrimaryVerified = new Set<string>();
  let artRows = 0;
  let artR2 = 0;
  let artPath = 0;
  for (const a of artwork) {
    artRows++;
    const k = coverKind(a.canonical_cover_path);
    if (k !== "missing") withCover.add(a.retroverse_album_id);
    if (k === "r2_http") artR2++;
    else if (k === "path") artPath++;
    if (a.is_primary && a.artwork_status === "verified" && k !== "missing") withPrimaryVerified.add(a.retroverse_album_id);
  }

  let full = 0;
  let partial = 0;
  let none = 0;
  let polluted = 0;
  const badExamples: string[] = [];

  for (const al of albums) {
    const titles = (primaryTracks.get(al.retroverse_album_id) ?? []).filter(Boolean);
    const vars = titles.filter((t) => VARIANT_RE.test(t));
    if (titles.length === 0) none++;
    else if (titles.length >= 6) full++;
    else partial++;
    if (vars.length > 0) {
      polluted++;
      if (badExamples.length < 12) badExamples.push(al.retroverse_album_id + " | " + al.canonical_album_title + " | " + vars.slice(0, 3).join("; "));
    }
  }

  const dossierIds = Object.keys(dossierJson.albums ?? {});
  const sequenceIds = Object.keys(sequencesJson.sequences ?? {});
  let dossierTracks = 0;
  let dossierPolluted = 0;
  for (const id of dossierIds) {
    const tr = dossierJson.albums[id]?.acoustic?.tracks ?? [];
    if (tr.length) dossierTracks++;
    if (tr.some((t) => VARIANT_RE.test(t.title))) dossierPolluted++;
  }

  let ready = 0;
  for (const id of b200) {
    const titles = primaryTracks.get(id) ?? [];
    const clean = titles.length >= 6 && titles.every((t) => !VARIANT_RE.test(t));
    if ((withPrimaryVerified.has(id) || withCover.has(id)) && clean) ready++;
  }

  const { count: enrichmentRowCount } = await sb.from("retroverse_track_enrichment").select("*", { count: "exact", head: true });
  const enrichSources = new Map<string, number>();
  if (enrichmentRowCount != null) enrichSources.set("retroverse_track_enrichment (all)", enrichmentRowCount);
  const matchSources = new Map<string, number>();
  for (const s of sourceMatches) matchSources.set(s.source, (matchSources.get(s.source) ?? 0) + 1);

  const thrillerRows = albums.filter((a) => /thriller/i.test(a.canonical_album_title));
  const thrillerNotes = thrillerRows.map((a) => {
    const d = dossierJson.albums[a.retroverse_album_id];
    const dt = (d?.acoustic?.tracks ?? []).map((t) => t.title);
    const pt = (primaryTracks.get(a.retroverse_album_id) ?? []).filter(Boolean);
    return {
      id: a.retroverse_album_id,
      title: a.canonical_album_title,
      b200_weeks: chartRuns.filter((c) => c.retroverse_album_id === a.retroverse_album_id).length,
      primary_tracks: pt.length,
      primary_sample: pt.slice(0, 9),
      dossier_tracks: dt.length,
      dossier_sample: dt.slice(0, 9),
      dossier_variants: dt.filter((t) => VARIANT_RE.test(t)).length,
      has_cover: withCover.has(a.retroverse_album_id),
    };
  });

  const sql = [
    "SELECT count(*) FROM retroverse_albums;",
    "SELECT count(*) FROM retroverse_album_editions;",
    "SELECT count(DISTINCT retroverse_artist_id || lower(canonical_album_title)) FROM retroverse_albums;",
    "SELECT count(DISTINCT retroverse_album_id) FROM canonical_album_chart_runs;",
    "SELECT count(*) FROM canonical_album_chart_runs;",
    "SELECT count(*) FROM retroverse_album_artwork WHERE canonical_cover_path IS NOT NULL AND btrim(canonical_cover_path) <> '';",
    "SELECT count(*) FROM retroverse_album_tracks at JOIN retroverse_album_editions ed ON ed.retroverse_album_edition_id = at.retroverse_album_edition_id AND ed.is_primary = true;",
    "SELECT count(*) FROM retroverse_track_enrichment;",
    "SELECT source, count(*) FROM retroverse_source_matches WHERE retroverse_entity_type = 'album' GROUP BY source;",
    "-- local PG:",
    "SELECT count(*) FROM albums;",
    "SELECT count(DISTINCT album_id) FROM album_track_lineage;",
    "SELECT source_provenance, count(*) FROM album_track_lineage GROUP BY source_provenance;",
  ].join("\n");

  const md: string[] = [];
  md.push("# Retroverse album coverage audit");
  md.push("");
  md.push("Generated: " + generatedAt);
  md.push("Database: " + url);
  md.push("Auth: " + (process.env.SUPABASE_SERVICE_ROLE_KEY ? "SUPABASE_SERVICE_ROLE_KEY" : "publishable key"));
  md.push("");

  md.push("## Section 1 — Album counts");
  md.push("| Metric | Count |");
  md.push("|--------|------:|");
  md.push("| Total canonical albums (retroverse_albums) | **" + albums.length + "** |");
  md.push("| Total album editions (retroverse_album_editions) | **" + editions.length + "** |");
  md.push("| Unique album titles (artist + title) | **" + uniqueTitles.size + "** |");
  md.push("| Albums with Billboard 200 history | **" + b200.size + "** |");
  md.push("| Total B200 chart-week rows | **" + (chartRunRows ?? 0) + "** |");
  md.push("");

  md.push("## Section 2 — Cover coverage");
  md.push("Covered = any retroverse_album_artwork row with non-empty canonical_cover_path.");
  md.push("Dossier-ready cover = primary + artwork_status verified + path.");
  md.push("| Metric | Count |");
  md.push("|--------|------:|");
  md.push("| Artwork rows | **" + artRows + "** |");
  md.push("| Rows with HTTP/R2 URL | **" + artR2 + "** |");
  md.push("| Rows with relative/path | **" + artPath + "** |");
  md.push("| Albums with any cover | **" + withCover.size + "** |");
  md.push("| Albums with primary verified cover | **" + withPrimaryVerified.size + "** |");
  md.push("| Albums missing cover | **" + (albums.length - withCover.size) + "** |");
  md.push("| B200 albums missing cover | **" + [...b200].filter((id) => !withCover.has(id)).length + "** |");
  md.push("");

  md.push("## Section 3 — Tracklist coverage (primary edition)");
  md.push("Original proxy: primary edition has 6+ tracks and zero variant-keyword titles.");
  md.push("| Metric | Count |");
  md.push("|--------|------:|");
  md.push("| Full primary (6+ tracks) | **" + full + "** |");
  md.push("| Partial primary (1-5) | **" + partial + "** |");
  md.push("| No primary tracks | **" + none + "** |");
  md.push("| Primary polluted (variant keywords) | **" + polluted + "** |");
  md.push("| Shipped dossiers (JSON) | **" + dossierIds.length + "** |");
  md.push("| Dossiers with acoustic tracks | **" + dossierTracks + "** |");
  md.push("| Dossiers with variant pollution | **" + dossierPolluted + "** |");
  md.push("| Manual canonical sequences JSON | **" + sequenceIds.length + "** |");
  md.push("");

  md.push("## Section 4 — Tracklist source analysis");
  md.push("### Supabase");
  md.push("| Source | Count |");
  md.push("|--------|------:|");
  md.push("| retroverse_album_tracks rows | **" + albumTracks.length + "** |");
  md.push("| retroverse_track_enrichment rows | **" + (enrichmentRowCount ?? 0) + "** |");
  for (const [k, v] of [...enrichSources.entries()].sort((a, b) => b[1] - a[1])) md.push("| enrichment_source " + k + " | **" + v + "** |");
  for (const [k, v] of [...matchSources.entries()].sort((a, b) => b[1] - a[1])) md.push("| source_match " + k + " | **" + v + "** |");
  md.push("");
  md.push("### Local PG");
  if (localPg.ok) for (const [k, v] of Object.entries(localPg.metrics)) md.push("- " + k + ": **" + v + "**");
  else md.push("- Not reachable: " + localPg.error);
  md.push("");
  md.push("Most reliable original sequencing: canonical-album-sequences.json (" + sequenceIds.length + " albums). Dossier acoustic rows are Spotify-derived and often polluted.");
  md.push("");

  md.push("## Section 5 — Quality audit");
  md.push("### Pollution samples (primary edition)");
  for (const row of badExamples) md.push("- " + row);
  md.push("");
  md.push("### Thriller");
  md.push("```json");
  md.push(JSON.stringify(thrillerNotes, null, 2));
  md.push("```");
  md.push("");

  md.push("## Section 6 — Dossier readiness");
  md.push("Definition: B200 + cover + primary 6+ tracks + no variant keywords.");
  md.push("| Metric | Count |");
  md.push("|--------|------:|");
  md.push("| B200 albums | **" + b200.size + "** |");
  md.push("| Fully ready | **" + ready + "** |");
  md.push("| Not ready | **" + (b200.size - ready) + "** |");
  md.push("");

  md.push("## Section 7 — Blockers");
  md.push("1. Primary tracklists empty on " + none + " / " + albums.length + " albums.");
  md.push("2. Dossier pollution on " + dossierPolluted + " / " + dossierTracks + " shipped dossiers with tracks.");
  md.push("3. Only " + sequenceIds.length + " manual canonical sequences.");
  md.push("4. " + [...b200].filter((id) => !withCover.has(id)).length + " B200 albums lack cover paths.");
  md.push("5. Serving uses dossier JSON acoustics, not Supabase primary track graph.");
  md.push("");
  md.push("## SQL executed");
  md.push("```sql");
  md.push(sql);
  md.push("```");

  writeFileSync(OUT_MD, md.join("\n"), "utf8");
  console.log("Wrote " + OUT_MD);
  console.log(JSON.stringify({ albums: albums.length, b200: b200.size, ready, dossier: dossierIds.length }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
