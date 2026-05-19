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
];

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

  const pushParams = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams();
      const artist = patch.artist ?? (data.selectedArtistId ? String(data.selectedArtistId) : null);
      const family = patch.family ?? (data.selectedFamilyId ? String(data.selectedFamilyId) : null);
      const view = patch.view ?? data.view;
      const q = patch.q ?? data.searchQ;

      if (artist) params.set("artist", artist);
      if (family) params.set("family", family);
      if (view && view !== "artists") params.set("view", view);
      if (q) params.set("q", q);

      startTransition(() => {
        router.push(`/integrity?${params.toString()}`);
      });
    },
    [router, data.selectedArtistId, data.selectedFamilyId, data.view, data.searchQ],
  );

  const filteredArtists = useMemo(() => data.artists, [data.artists]);

  return (
    <div className="ic-layout">
      <aside className="ic-sidebar">
        <div className="ic-sidebar-head">
          <p className="ic-title">Integrity Console</p>
          <p className="ic-sub">Identity graph · read-only</p>
          <input
            className="ic-search"
            type="search"
            placeholder="Artist or family…"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") pushParams({ q: searchDraft || null, family: null });
            }}
          />
        </div>

        <nav className="ic-nav" aria-label="Sections">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              data-active={data.view === v.id}
              onClick={() => pushParams({ view: v.id, family: null })}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="ic-artist-list">
          {filteredArtists.map((a) => (
            <button
              key={a.id}
              type="button"
              className="ic-artist-item"
              data-active={data.selectedArtistId === a.id}
              onClick={() => pushParams({ artist: String(a.id), family: null })}
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
        {data.artist ? (
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
                      family #{data.familyDetail.id} · artist {data.familyDetail.artist_name} ·
                      key {data.familyDetail.normalized_family_key}
                    </p>
                  </div>
                  <div className="ic-table-wrap">
                    <table className="ic-table">
                      <thead>
                        <tr>
                          <th>Track ID</th>
                          <th>Title</th>
                          <th>Relationship</th>
                          <th>Primary</th>
                          <th>Variant</th>
                          <th>Chart Rows</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.familyDetail.members.map((m) => (
                          <tr
                            key={m.track_id}
                            className={memberRowClass(
                              m.variant_classification,
                              m.is_primary_recording,
                            )}
                          >
                            <td>{m.track_id}</td>
                            <td>{m.title}</td>
                            <td>{m.relationship_type}</td>
                            <td>{m.is_primary_recording ? "yes" : ""}</td>
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
        ) : (
          <div className="ic-empty">No artists with track families found.</div>
        )}
      </main>
    </div>
  );
}
