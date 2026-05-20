"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";

import type { ExplorerData, IntegrityView } from "@/lib/integrity-console/types";

const VIEWS: { id: IntegrityView; label: string }[] = [
  { id: "artists", label: "Artists" },
  { id: "families", label: "Track Families" },
  { id: "variants", label: "Variants" },
  { id: "relationships", label: "Relationships" },
  { id: "albums", label: "Albums" },
  { id: "album-families", label: "Album Families" },
  { id: "editions", label: "Editions" },
  { id: "b200", label: "Billboard 200" },
  { id: "tracklists", label: "Album Tracklists" },
  { id: "linkage", label: "Linkage" },
  { id: "hot100-album", label: "Hot 100 → Album" },
  { id: "album-track-links", label: "Album ↔ Family" },
  { id: "media-graph", label: "Media Graph" },
  { id: "media", label: "Media Assets" },
  { id: "vdj-assets", label: "VirtualDJ Assets" },
  { id: "vdj", label: "VDJ Candidates" },
  { id: "r2-sync", label: "R2 Sync Analysis" },
  { id: "thumbnail-coverage", label: "Thumbnail Coverage" },
  { id: "youtube-enrichment", label: "YouTube Enrichment" },
  { id: "cover-summary", label: "Album Covers" },
  { id: "cover-links", label: "Cover Links" },
  { id: "cover-missing", label: "Missing Covers" },
  { id: "cover-r2", label: "R2 Cover Links" },
  { id: "cover-curated", label: "Curated Covers" },
  { id: "cover-review", label: "Cover Review Queue" },
  { id: "acoustic-linkage", label: "Acoustic Linkage" },
  { id: "acoustic-tracklists", label: "Acoustic Tracklists" },
  { id: "acoustic-hot100", label: "Hot 100 Backfill" },
  { id: "acoustic-ambiguous", label: "Multi-Album Songs" },
];

const ACOUSTIC_VIEWS = new Set<IntegrityView>([
  "acoustic-linkage",
  "acoustic-tracklists",
  "acoustic-hot100",
  "acoustic-ambiguous",
]);

const LINKAGE_VIEWS = new Set<IntegrityView>([
  "linkage",
  "hot100-album",
  "album-track-links",
]);

const MEDIA_VIEWS = new Set<IntegrityView>([
  "media-graph",
  "media",
  "vdj-assets",
  "vdj",
  "r2-sync",
  "thumbnail-coverage",
  "youtube-enrichment",
]);

const COVER_VIEWS = new Set<IntegrityView>([
  "cover-summary",
  "cover-links",
  "cover-missing",
  "cover-r2",
  "cover-curated",
  "cover-review",
]);

const ALBUM_VIEWS = new Set<IntegrityView>([
  "albums",
  "album-families",
  "editions",
  "b200",
  "tracklists",
]);

function memberRowClass(variant: string, isPrimary: boolean): string {
  if (isPrimary) return "ic-row-primary";
  if (variant === "live") return "ic-row-live";
  if (variant === "remaster") return "ic-row-remaster";
  if (variant === "remix") return "ic-row-remix";
  return "";
}

export function IntegrityExplorer({ data }: { data: ExplorerData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [searchDraft, setSearchDraft] = useState(data.searchQ);
  const albumMode = ALBUM_VIEWS.has(data.view);
  const linkageMode = LINKAGE_VIEWS.has(data.view);
  const mediaMode = MEDIA_VIEWS.has(data.view);
  const coverMode = COVER_VIEWS.has(data.view);
  const acousticMode = ACOUSTIC_VIEWS.has(data.view);

  const pushParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams();
      const artist = patch.artist ?? (data.selectedArtistId ? String(data.selectedArtistId) : null);
      const family = patch.family ?? (data.selectedFamilyId ? String(data.selectedFamilyId) : null);
      const album = patch.album ?? (data.selectedAlbumId ? String(data.selectedAlbumId) : null);
      const view = patch.view ?? data.view;
      const q = patch.q ?? data.searchQ;

      if (artist) params.set("artist", artist);
      if (family) params.set("family", family);
      if (album) params.set("album", album);
      if (view && view !== "artists") params.set("view", view);
      if (q) params.set("q", q);

      startTransition(() => {
        router.push(`/integrity?${params.toString()}`);
      });
    },
    [
      router,
      data.selectedArtistId,
      data.selectedFamilyId,
      data.selectedAlbumId,
      data.view,
      data.searchQ,
    ],
  );

  const filteredArtists = useMemo(() => data.artists, [data.artists]);
  const filteredAlbums = useMemo(() => data.albums, [data.albums]);

  return (
    <div className="ic-layout">
      <aside className="ic-sidebar">
        <div className="ic-sidebar-head">
          <p className="ic-title">Integrity Console</p>
          <p className="ic-sub">Historical album graph · read-only</p>
          <input
            className="ic-search"
            type="search"
            placeholder={
              albumMode
                ? "Album or artist…"
                : linkageMode || mediaMode || coverMode || acousticMode
                  ? "Browse linkage / media / covers…"
                  : "Artist or family…"
            }
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushParams({ q: searchDraft || null, family: null, album: null });
            }}
          />
        </div>

        <nav className="ic-nav" aria-label="Sections">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              data-active={data.view === v.id}
              onClick={() =>
                pushParams({
                  view: v.id,
                  family: null,
                  album: ALBUM_VIEWS.has(v.id) ? (data.selectedAlbumId ? String(data.selectedAlbumId) : null) : null,
                })
              }
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="ic-artist-list">
          {albumMode
            ? filteredAlbums.map((al) => (
                <button
                  key={al.id}
                  type="button"
                  className="ic-artist-item"
                  data-active={data.selectedAlbumId === al.id}
                  onClick={() => pushParams({ view: data.view, album: String(al.id), family: null })}
                >
                  {al.title}
                  <span className="ic-artist-meta">
                    {al.artist_name} · {al.b200_chart_rows} b200
                  </span>
                </button>
              ))
            : filteredArtists.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="ic-artist-item"
                  data-active={data.selectedArtistId === a.id}
                  onClick={() => pushParams({ artist: String(a.id), family: null, album: null })}
                >
                  {a.canonical_name}
                  <span className="ic-artist-meta">
                    {a.family_count} fam · {a.track_count} trk
                  </span>
                </button>
              ))}
        </div>

        <div className="ic-footer-link">
          <Link href="/integrity/reports">Supabase audit reports →</Link>
        </div>
      </aside>

      <main className="ic-main">
        {acousticMode ? (
          <AcousticPanels data={data} pending={pending} />
        ) : mediaMode ? (
          <MediaPanels data={data} pending={pending} />
        ) : coverMode ? (
          <CoverPanels data={data} pending={pending} />
        ) : linkageMode ? (
          <LinkagePanels data={data} pending={pending} />
        ) : albumMode ? (
          <AlbumPanels data={data} pending={pending} pushParams={pushParams} />
        ) : data.artist ? (
          <ArtistPanels data={data} pending={pending} pushParams={pushParams} />
        ) : (
          <div className="ic-empty">No artists with track families found.</div>
        )}
      </main>
    </div>
  );
}

function ArtistPanels({
  data,
  pending,
  pushParams,
}: {
  data: ExplorerData;
  pending: boolean;
  pushParams: (patch: Record<string, string | null>) => void;
}) {
  if (!data.artist) return null;
  return (
    <>
      <header className="ic-header">
        <h1>
          {data.artist.canonical_name}
          <span className="ic-readonly">read-only</span>
        </h1>
        <div className="ic-stats">
          <span>
            families <strong>{data.artist.family_count}</strong>
          </span>
          <span>
            tracks <strong>{data.artist.track_count}</strong>
          </span>
          <span>
            variants <strong>{data.artist.variant_count}</strong>
          </span>
          {pending ? <span>loading…</span> : null}
        </div>
      </header>
      <div className="ic-body">
        {data.view === "relationships" ? (
          <>
            <p className="ic-section-label">Lineage relationships (sample)</p>
            <div className="ic-table-wrap">
              <table className="ic-table">
                <thead>
                  <tr>
                    <th>Family</th>
                    <th>Track A</th>
                    <th>Track B</th>
                    <th>Type</th>
                    <th>Conf</th>
                  </tr>
                </thead>
                <tbody>
                  {data.relationships.map((r) => (
                    <tr key={`${r.track_a_id}-${r.track_b_id}`}>
                      <td>{r.family_name}</td>
                      <td title={r.track_a_title}>
                        {r.track_a_id} · {r.track_a_title}
                      </td>
                      <td title={r.track_b_title}>
                        {r.track_b_id} · {r.track_b_title}
                      </td>
                      <td>{r.relationship_type}</td>
                      <td>{r.confidence_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <p className="ic-section-label">
              {data.view === "variants" ? "Families with variants" : "Track families"}
            </p>
            <div className="ic-table-wrap">
              <table className="ic-table">
                <thead>
                  <tr>
                    <th>Family ID</th>
                    <th>Canonical Name</th>
                    <th>Tracks</th>
                    <th>Primary Recording</th>
                    <th>Variants</th>
                  </tr>
                </thead>
                <tbody>
                  {data.families.map((f) => (
                    <tr
                      key={f.id}
                      data-selected={data.selectedFamilyId === f.id}
                      onClick={() =>
                        pushParams({
                          artist: String(data.selectedArtistId),
                          family: String(f.id),
                        })
                      }
                    >
                      <td>{f.id}</td>
                      <td>{f.canonical_name}</td>
                      <td>{f.track_count}</td>
                      <td>{f.primary_recording ?? "—"}</td>
                      <td>{f.variant_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {data.familyDetail ? (
          <section className="ic-detail">
            <div className="ic-detail-head">
              <h2>{data.familyDetail.canonical_name}</h2>
              <p className="ic-detail-meta">
                family #{data.familyDetail.id} · artist {data.familyDetail.artist_name}
              </p>
            </div>
            <div className="ic-table-wrap">
              <table className="ic-table">
                <thead>
                  <tr>
                    <th>Track ID</th>
                    <th>Title</th>
                    <th>Relationship</th>
                    <th>Variant</th>
                    <th>Chart Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {data.familyDetail.members.map((m) => (
                    <tr
                      key={m.track_id}
                      className={memberRowClass(m.variant_classification, m.is_primary_recording)}
                    >
                      <td>{m.track_id}</td>
                      <td>{m.title}</td>
                      <td>{m.relationship_type}</td>
                      <td>{m.variant_classification}</td>
                      <td>{m.chart_row_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

function AlbumPanels({
  data,
  pending,
  pushParams,
}: {
  data: ExplorerData;
  pending: boolean;
  pushParams: (patch: Record<string, string | null>) => void;
}) {
  if (data.view === "album-families") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Album families
            <span className="ic-readonly">read-only</span>
          </h1>
          <div className="ic-stats">
            <span>
              registry <strong>{data.albumPopulationRows.length}</strong>
            </span>
          </div>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">album_population_registry</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Album</th>
                  <th>Artist</th>
                  <th>ID</th>
                  <th>Staging</th>
                  <th>Editions</th>
                  <th>First</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {data.albumPopulationRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>No registry — run 604</td>
                  </tr>
                ) : (
                  data.albumPopulationRows.map((r) => (
                    <tr
                      key={r.proposed_album_key}
                      role={r.album_id ? "button" : undefined}
                      onClick={() =>
                        r.album_id
                          ? pushParams({ view: "albums", album: String(r.album_id) })
                          : undefined
                      }
                    >
                      <td title={r.proposed_album_key}>
                        {r.proposed_album_key.length > 36
                          ? `${r.proposed_album_key.slice(0, 36)}…`
                          : r.proposed_album_key}
                      </td>
                      <td>{r.canonical_album_name}</td>
                      <td>{r.artist_name}</td>
                      <td>{r.album_id ?? "—"}</td>
                      <td>{r.staging_row_count ?? "—"}</td>
                      <td>{r.edition_count}</td>
                      <td>{r.first_chart_date ?? "—"}</td>
                      <td>{r.last_chart_date ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "editions") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Album editions
            <span className="ic-readonly">read-only</span>
          </h1>
          <div className="ic-stats">
            <span>
              rows <strong>{data.editionRows.length}</strong>
            </span>
          </div>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">album_editions</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>Edition</th>
                  <th>Year</th>
                  <th>Canonical</th>
                </tr>
              </thead>
              <tbody>
                {data.editionRows.map((e) => (
                  <tr
                    key={e.edition_id}
                    role="button"
                    onClick={() => pushParams({ view: "albums", album: String(e.album_id) })}
                  >
                    <td>{e.artist_name}</td>
                    <td>{e.album_title}</td>
                    <td>{e.edition_name}</td>
                    <td>{e.release_year ?? "—"}</td>
                    <td>{e.is_canonical ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "b200") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Billboard 200 lineage
            <span className="ic-readonly">read-only</span>
          </h1>
          <div className="ic-stats">
            <span>
              rows <strong>{data.b200Rows.length}</strong>
            </span>
            {pending ? <span>loading…</span> : null}
          </div>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">Album timelines</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>Weeks</th>
                  <th>Peak</th>
                  <th>First</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {data.b200Timelines.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No timelines — run 604/605</td>
                  </tr>
                ) : (
                  data.b200Timelines.map((t) => (
                    <tr
                      key={t.album_id}
                      role="button"
                      onClick={() => pushParams({ view: "albums", album: String(t.album_id) })}
                    >
                      <td>{t.artist_name}</td>
                      <td>{t.album_title}</td>
                      <td>{t.chart_weeks}</td>
                      <td>{t.peak_position ?? "—"}</td>
                      <td>{t.first_chart_date ?? "—"}</td>
                      <td>{t.last_chart_date ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="ic-section-label">Recent chart appearances (album-anchored)</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rank</th>
                  <th>Weeks</th>
                  <th>Album</th>
                  <th>Artist</th>
                </tr>
              </thead>
              <tbody>
                {data.b200Rows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No Billboard 200 rows yet — run 501/502 after staging load</td>
                  </tr>
                ) : (
                  data.b200Rows.map((r, i) => (
                    <tr key={`${r.chart_date}-${i}`}>
                      <td>{r.chart_date}</td>
                      <td>{r.chart_position ?? "—"}</td>
                      <td>{r.weeks_on_chart ?? "—"}</td>
                      <td>{r.album_title ?? "—"}</td>
                      <td>{r.artist_name ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "tracklists") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Album tracklists
            <span className="ic-readonly">read-only</span>
          </h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">album_track_lineage</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>#</th>
                  <th>Track</th>
                  <th>Family</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {data.tracklistRows.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No lineage rows — run 501/504</td>
                  </tr>
                ) : (
                  data.tracklistRows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.artist_name}</td>
                      <td>{r.album_title}</td>
                      <td>{r.track_number ?? r.sequence_index}</td>
                      <td>{r.track_title ?? "—"}</td>
                      <td>{r.track_family_name ?? "—"}</td>
                      <td>{r.source_provenance}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  const al = data.albumDetail;
  if (!al) return <div className="ic-empty">Select an album</div>;

  return (
    <>
      <header className="ic-header">
        <h1>
          {al.title}
          <span className="ic-readonly">read-only</span>
        </h1>
        <div className="ic-stats">
          <span>
            artist <strong>{al.artist_name}</strong>
          </span>
          <span>
            editions <strong>{al.editions.length}</strong>
          </span>
          <span>
            families <strong>{al.families.length}</strong>
          </span>
          <span>
            b200 weeks <strong>{al.b200.length}</strong>
          </span>
        </div>
      </header>
      <div className="ic-body">
        <p className="ic-section-label">Editions</p>
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Edition</th>
                <th>Year</th>
                <th>Canonical</th>
              </tr>
            </thead>
            <tbody>
              {al.editions.map((e) => (
                <tr key={e.id}>
                  <td>{e.id}</td>
                  <td>{e.edition_name}</td>
                  <td>{e.release_year ?? "—"}</td>
                  <td>{e.is_canonical ? "yes" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="ic-section-label">Track families on album</p>
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                <th>Family ID</th>
                <th>Name</th>
                <th>Members</th>
              </tr>
            </thead>
            <tbody>
              {al.families.map((f) => (
                <tr key={f.track_family_id}>
                  <td>{f.track_family_id}</td>
                  <td>{f.track_family_name}</td>
                  <td>{f.member_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="ic-section-label">Album track lineage</p>
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                <th>Disc</th>
                <th>#</th>
                <th>Title</th>
                <th>Family</th>
                <th>Rel</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {al.lineage.map((r, i) => (
                <tr
                  key={i}
                  className={memberRowClass(r.relationship_type ?? "", r.is_primary_recording ?? false)}
                >
                  <td>{r.disc_number ?? 1}</td>
                  <td>{r.track_number ?? r.sequence_index}</td>
                  <td>{r.track_title ?? "—"}</td>
                  <td>{r.track_family_name ?? "—"}</td>
                  <td>{r.relationship_type ?? "—"}</td>
                  <td>{r.source_provenance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {al.b200.length > 0 ? (
          <>
            <p className="ic-section-label">Billboard 200 weeks</p>
            <div className="ic-table-wrap">
              <table className="ic-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Rank</th>
                    <th>Weeks</th>
                  </tr>
                </thead>
                <tbody>
                  {al.b200.map((r, i) => (
                    <tr key={`${r.chart_date}-${i}`}>
                      <td>{r.chart_date}</td>
                      <td>{r.chart_position ?? "—"}</td>
                      <td>{r.weeks_on_chart ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

function LinkagePanels({ data, pending }: { data: ExplorerData; pending: boolean }) {
  const s = data.linkageSummary;

  if (data.view === "linkage" && s) {
    return (
      <>
        <header className="ic-header">
          <h1>
            Canonical linkage
            <span className="ic-readonly">read-only</span>
          </h1>
          {pending ? <span>loading…</span> : null}
        </header>
        <div className="ic-body">
          <p className="ic-section-label">Phase 7 bridge layer</p>
          <div className="ic-stats" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
            <span>
              track↔album links <strong>{s.ctal_total}</strong> ({s.ctal_ok} ok)
            </span>
            <span>
              Hot 100↔album links <strong>{s.chart_links}</strong> ({s.chart_ok} ok)
            </span>
            <span>
              Hot 100 unresolved <strong>{s.hot100_unresolved}</strong>
            </span>
            <span>
              VDJ staging rows <strong>{s.vdj_staging}</strong>
            </span>
            <span>
              media assets <strong>{s.media_assets}</strong>
            </span>
          </div>
          <p className="ic-hint">Run 701→708 in integrity_console/sql. VDJ import optional.</p>
        </div>
      </>
    );
  }

  if (data.view === "hot100-album") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Hot 100 → Album
            <span className="ic-readonly">read-only</span>
          </h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">chart_track_album_links</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rank</th>
                  <th>Artist</th>
                  <th>Track</th>
                  <th>Album</th>
                  <th>Conf</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {data.hot100AlbumLinks.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No links — run 703 then 705</td>
                  </tr>
                ) : (
                  data.hot100AlbumLinks.map((r) => (
                    <tr key={r.id}>
                      <td>{r.chart_date}</td>
                      <td>{r.chart_position ?? "—"}</td>
                      <td>{r.artist}</td>
                      <td>{r.track_title}</td>
                      <td>{r.album_title ?? "—"}</td>
                      <td>{r.confidence_score ?? "—"}</td>
                      <td>{r.review_flag}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "album-track-links") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Album ↔ Track Family
            <span className="ic-readonly">read-only</span>
          </h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">canonical_track_album_links</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th>Family</th>
                  <th>Album</th>
                  <th>Edition</th>
                  <th>#</th>
                  <th>Source</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {data.albumTrackLinks.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No links — run 703</td>
                  </tr>
                ) : (
                  data.albumTrackLinks.map((r) => (
                    <tr key={r.id}>
                      <td>{r.artist_name}</td>
                      <td>{r.track_family_name}</td>
                      <td>{r.album_title}</td>
                      <td>{r.edition_name ?? "—"}</td>
                      <td>{r.track_number ?? "—"}</td>
                      <td>{r.source}</td>
                      <td>{r.review_flag}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  return <div className="ic-empty">Select a linkage view from the sidebar.</div>;
}


function MediaPanels({ data, pending }: { data: ExplorerData; pending: boolean }) {
  const s = data.mediaGraphSummary;

  if (data.view === "media-graph" && s) {
    return (
      <>
        <header className="ic-header">
          <h1>
            Media asset graph
            <span className="ic-readonly">read-only</span>
          </h1>
          {pending ? <span>loading…</span> : null}
        </header>
        <div className="ic-body">
          <p className="ic-section-label">Phase 9 — operational ↔ canonical linkage</p>
          <div className="ic-stats" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
            <span>VDJ staging <strong>{s.vdj_staging}</strong></span>
            <span>media assets <strong>{s.media_assets}</strong> ({s.vdj_media_assets} from VDJ)</span>
            <span>linked tracks <strong>{s.linked_tracks}</strong></span>
            <span>unresolved media <strong>{s.unresolved_media}</strong></span>
            <span>thumbnail refs <strong>{s.thumbnail_refs}</strong></span>
            <span>probable R2 paths <strong>{s.probable_r2}</strong></span>
            <span>YouTube staging <strong>{s.youtube_staging}</strong> ({s.youtube_videos} videos)</span>
          </div>
          <p className="ic-hint">Run 901→910 in integrity_console/sql. See README Phase 9.</p>
        </div>
      </>
    );
  }

  if (data.view === "media") {
    return (
      <>
        <header className="ic-header">
          <h1>Media assets<span className="ic-readonly">read-only</span></h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">media_assets</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr><th>System</th><th>Artist</th><th>Title</th><th>Plays</th><th>R2</th><th>Linked</th></tr>
              </thead>
              <tbody>
                {data.mediaAssets.length === 0 ? (
                  <tr><td colSpan={6}>No media assets — run 901→906</td></tr>
                ) : (
                  data.mediaAssets.map((r) => (
                    <tr key={r.id}>
                      <td>{r.source_system}</td>
                      <td>{r.artist_text ?? "—"}</td>
                      <td>{r.title_text ?? "—"}</td>
                      <td>{r.play_count ?? "—"}</td>
                      <td>{r.r2_media_key ? "yes" : "—"}</td>
                      <td>{r.linked ? "yes" : "no"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "vdj-assets") {
    return (
      <>
        <header className="ic-header">
          <h1>VirtualDJ assets<span className="ic-readonly">read-only</span></h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">staging_virtualdj_tracks</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr><th>File</th><th>Artist</th><th>Title</th><th>Plays</th><th>Dur</th><th>Thumb</th></tr>
              </thead>
              <tbody>
                {data.vdjAssets.length === 0 ? (
                  <tr><td colSpan={6}>No staging rows — parse XML + 904</td></tr>
                ) : (
                  data.vdjAssets.map((r) => (
                    <tr key={r.id}>
                      <td title={r.source_path}>{r.filename ?? r.source_path.split("/").pop()}</td>
                      <td>{r.artist_text ?? "—"}</td>
                      <td>{r.title_text ?? "—"}</td>
                      <td>{r.play_count ?? "—"}</td>
                      <td>{r.duration_seconds ?? "—"}</td>
                      <td>{r.thumbnail_path ? "yes" : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "r2-sync") {
    return (
      <>
        <header className="ic-header">
          <h1>R2 sync analysis<span className="ic-readonly">read-only</span></h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">local path → probable R2 keys</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr><th>Artist</th><th>Title</th><th>Status</th><th>R2 key</th><th>Miss thumb</th></tr>
              </thead>
              <tbody>
                {data.r2SyncRows.length === 0 ? (
                  <tr><td colSpan={5}>No VDJ media assets — run 906</td></tr>
                ) : (
                  data.r2SyncRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.artist_text ?? "—"}</td>
                      <td>{r.title_text ?? "—"}</td>
                      <td>{r.sync_status}</td>
                      <td title={r.probable_r2_media_key ?? undefined}>{r.probable_r2_media_key?.slice(0, 36) ?? "—"}</td>
                      <td>{r.missing_thumbnail ? "yes" : "no"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "thumbnail-coverage") {
    return (
      <>
        <header className="ic-header">
          <h1>Thumbnail coverage<span className="ic-readonly">read-only</span></h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">local vs R2 thumbnail refs</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr><th>Artist</th><th>Title</th><th>Status</th><th>Local</th><th>R2</th></tr>
              </thead>
              <tbody>
                {data.thumbnailCoverage.map((r) => (
                  <tr key={r.id}>
                    <td>{r.artist_text ?? "—"}</td>
                    <td>{r.title_text ?? "—"}</td>
                    <td>{r.coverage_status}</td>
                    <td>{r.local_thumbnail_path ? "yes" : "—"}</td>
                    <td>{r.r2_thumbnail_key ? "yes" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "youtube-enrichment") {
    return (
      <>
        <header className="ic-header">
          <h1>YouTube enrichment<span className="ic-readonly">read-only</span></h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">staging_youtube_link_imports</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr><th>Artist</th><th>Title</th><th>Video</th><th>Source</th><th>Track</th><th>Conf</th><th>Review</th></tr>
              </thead>
              <tbody>
                {data.youtubeEnrichment.length === 0 ? (
                  <tr><td colSpan={7}>No imports — export_youtube + 909</td></tr>
                ) : (
                  data.youtubeEnrichment.map((r) => (
                    <tr key={r.id}>
                      <td>{r.artist_text ?? "—"}</td>
                      <td>{r.title_text ?? "—"}</td>
                      <td>{r.youtube_video_id ?? "—"}</td>
                      <td>{r.source}</td>
                      <td>{r.candidate_track_id ?? "—"}</td>
                      <td>{r.confidence_score}</td>
                      <td>{r.review_flag}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="ic-header">
        <h1>VDJ linkage candidates<span className="ic-readonly">read-only</span></h1>
      </header>
      <div className="ic-body">
        <p className="ic-section-label">media_asset_link_candidates</p>
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr><th>Path</th><th>Artist</th><th>Title</th><th>Track</th><th>Family</th><th>Album</th><th>Conf</th><th>Reason</th><th>Review</th></tr>
            </thead>
            <tbody>
              {data.vdjCandidates.length === 0 ? (
                <tr><td colSpan={9}>No candidates — run 905</td></tr>
              ) : (
                data.vdjCandidates.map((r) => (
                  <tr key={r.vdj_staging_id}>
                    <td title={r.source_path}>{r.source_path.split("/").pop()}</td>
                    <td>{r.artist_text ?? "—"}</td>
                    <td>{r.title_text ?? "—"}</td>
                    <td>{r.candidate_track_id ?? "—"}</td>
                    <td>{r.candidate_track_family_id ?? "—"}</td>
                    <td>{r.candidate_album_id ?? "—"}</td>
                    <td>{r.confidence_score ?? "—"}</td>
                    <td>{r.match_reason}</td>
                    <td>{r.review_flag}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}


function CoverPanels({ data, pending }: { data: ExplorerData; pending: boolean }) {
  const s = data.coverSummary;
  if (data.view === "cover-summary" && s) {
    return (
      <>
        <header className="ic-header">
          <h1>Album covers<span className="ic-readonly">read-only</span></h1>
          {pending ? <span>loading…</span> : null}
        </header>
        <div className="ic-body">
          <p className="ic-section-label">Phase 10 artwork linkage</p>
          <div className="ic-stats" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
            <span>albums with links <strong>{s.albumsWithLinks}</strong></span>
            <span>missing covers <strong>{s.albumsMissingCovers}</strong></span>
            <span>R2 cover keys <strong>{s.r2CoverLinks}</strong></span>
            <span>curated <strong>{s.curatedCovers}</strong></span>
            <span>unresolved <strong>{s.unresolvedCovers}</strong></span>
          </div>
        </div>
      </>
    );
  }
  const rows =
    data.view === "cover-missing"
      ? data.coverMissing
      : data.view === "cover-r2"
        ? data.coverR2Links
        : data.view === "cover-curated"
          ? data.coverCurated
          : data.view === "cover-review"
            ? data.coverReviewQueue
            : data.coverLinks;
  const title =
    data.view === "cover-missing"
      ? "Missing covers"
      : data.view === "cover-r2"
        ? "R2 cover links"
        : data.view === "cover-curated"
          ? "Curated cover status"
          : data.view === "cover-review"
            ? "Cover review queue"
            : "Album artwork links";
  return (
    <>
      <header className="ic-header">
        <h1>{title}<span className="ic-readonly">read-only</span></h1>
      </header>
      <div className="ic-body">
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                <th>Artist</th>
                <th>Album</th>
                <th>Path</th>
                <th>R2</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5}>No rows — run 1001–1003</td>
                </tr>
              ) : (
                (rows as Array<{
                  albumId: number;
                  artistName?: string;
                  albumTitle?: string;
                  canonicalCoverPath?: string | null;
                  r2CoverKey?: string | null;
                  reviewFlag?: string;
                  externalKey?: string | null;
                }>).map((r) => (
                  <tr key={`${r.albumId}-${r.reviewFlag ?? "x"}`}>
                    <td>{r.artistName ?? "—"}</td>
                    <td>{r.albumTitle ?? "—"}</td>
                    <td>{r.canonicalCoverPath?.slice(0, 36) ?? r.externalKey ?? "—"}</td>
                    <td>{r.r2CoverKey ? "yes" : "—"}</td>
                    <td>{r.reviewFlag ?? "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function AcousticPanels({ data, pending }: { data: ExplorerData; pending: boolean }) {
  const s = data.acousticSummary;

  if (data.view === "acoustic-linkage" && s) {
    return (
      <>
        <header className="ic-header">
          <h1>
            Acoustic linkage
            <span className="ic-readonly">read-only</span>
          </h1>
          {pending ? <span>loading…</span> : null}
        </header>
        <div className="ic-body">
          <p className="ic-section-label">Phase 8A materialization</p>
          <div className="ic-stats" style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.5rem" }}>
            <span>
              staging rows <strong>{s.staging_rows}</strong>
            </span>
            <span>
              candidates <strong>{s.candidates}</strong> ({s.ok_candidates} ok)
            </span>
            <span>
              review required <strong>{s.review_candidates}</strong>
            </span>
            <span>
              acoustics lineage <strong>{s.acoustics_lineage}</strong>
            </span>
            <span>
              acoustics ctal <strong>{s.acoustics_ctal}</strong>
            </span>
            <span>
              Hot 100 acoustic links <strong>{s.hot100_acoustic_links}</strong>
            </span>
            <span>
              Hot 100 unresolved <strong>{s.hot100_unresolved}</strong>
            </span>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "acoustic-tracklists") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Album tracklists (acoustics)
            <span className="ic-readonly">read-only</span>
          </h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">album_track_lineage · source=acoustics</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>#</th>
                  <th>Source song</th>
                  <th>Family</th>
                  <th>Track</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {data.acousticTracklists.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No rows — run 801–805</td>
                  </tr>
                ) : (
                  data.acousticTracklists.map((r, i) => (
                    <tr key={i}>
                      <td>{r.artist_name}</td>
                      <td>{r.album_title}</td>
                      <td>{r.sequence_index ?? "—"}</td>
                      <td>{r.source_song}</td>
                      <td>{r.track_family_name ?? "—"}</td>
                      <td>{r.track_title ?? "—"}</td>
                      <td>{r.review_flag ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  if (data.view === "acoustic-hot100") {
    return (
      <>
        <header className="ic-header">
          <h1>
            Hot 100 album backfill
            <span className="ic-readonly">read-only</span>
          </h1>
        </header>
        <div className="ic-body">
          <p className="ic-section-label">chart_track_album_links · acoustics_hot100_backfill</p>
          <div className="ic-table-wrap">
            <table className="ic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Rank</th>
                  <th>Artist</th>
                  <th>Track</th>
                  <th>Album</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {data.acousticHot100Links.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No backfill rows — run 806</td>
                  </tr>
                ) : (
                  data.acousticHot100Links.map((r) => (
                    <tr key={r.id}>
                      <td>{r.chart_date}</td>
                      <td>{r.chart_position ?? "—"}</td>
                      <td>{r.artist}</td>
                      <td>{r.track_title}</td>
                      <td>{r.album_title ?? "—"}</td>
                      <td>{r.review_flag}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="ic-header">
        <h1>
          Multi-album songs
          <span className="ic-readonly">read-only</span>
        </h1>
      </header>
      <div className="ic-body">
        <p className="ic-section-label">Same song on multiple albums (valid history)</p>
        <div className="ic-table-wrap">
          <table className="ic-table">
            <thead>
              <tr>
                <th>Artist</th>
                <th>Song</th>
                <th>Albums</th>
                <th>Staging rows</th>
              </tr>
            </thead>
            <tbody>
              {data.acousticAmbiguous.map((r, i) => (
                <tr key={i}>
                  <td>{r.source_artist}</td>
                  <td>{r.source_song}</td>
                  <td>{r.album_count}</td>
                  <td>{r.staging_rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
