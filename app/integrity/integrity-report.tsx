import Link from "next/link";
import type { ReactNode } from "react";

import type { IntegrityAuditResult, Severity } from "./load-integrity-audits";

function Sev({ s }: { s: Severity }) {
  const cls =
    s === "CRITICAL"
      ? "int-sev int-sev-crit"
      : s === "WARNING"
        ? "int-sev int-sev-warn"
        : "int-sev int-sev-info";
  return <span className={cls}>{s}</span>;
}

function RvalLink({ id, label }: { id: string; label?: ReactNode }) {
  if (!id || id === "—") return <span>{label ?? id}</span>;
  const href = `/chart-inspector?album=${encodeURIComponent(id)}`;
  return (
    <Link className="int-link" href={href} prefetch={false}>
      {label ?? id}
    </Link>
  );
}

export function IntegrityReport({ data }: { data: IntegrityAuditResult }) {
  const a1 = data.audit1_orphans;
  const a2 = data.audit2_duplicate_titles;
  const a3 = data.audit3_split_charts;
  const a4 = data.audit4_chronology;
  const audit5 = data.audit5_spine;
  const a5 = audit5.summary;

  return (
    <>
      <h1 className="int-h1">Retroverse integrity</h1>
      <p className="int-sub">
        Internal diagnostics · read-only · generated {data.generatedAt}
        {data.album_table_total != null ? ` · retroverse_albums count ${data.album_table_total}` : null}
        {data.canonical_spine_reachable
          ? data.albums_with_canonical_rows > 0
            ? ` · albums on canonical spine ${data.albums_with_canonical_rows}`
            : " · canonical spine: 0 albums"
          : " · canonical spine: unreachable (PostgREST)"}
      </p>

      {data.warnings.length > 0 ? (
        <div className="int-warn-banner">
          {data.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      ) : null}

      {data.error ? <p className="int-err">{data.error}</p> : null}

      {!data.error ? (
        <>
          <section className="int-card">
            <h2>
              <Sev s={a1.severity} />
              Audit 1 — Orphaned albums
            </h2>
            <p className="int-meta">
              Albums in retroverse_albums with zero canonical_album_chart_runs rows.
            </p>
            {a1.skipped ? (
              <p className="int-warn-inline">Skipped. {a1.skip_reason}</p>
            ) : (
              <>
                <p>
                  <strong>Total orphans:</strong> {a1.total_orphan_albums.toLocaleString()}
                </p>
                {a1.samples.length > 0 ? (
                  <div className="int-table-wrap">
                    <table className="int-table">
                      <thead>
                        <tr>
                          <th>RVAL</th>
                          <th>Title</th>
                          <th>Artist</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a1.samples.map((r) => (
                          <tr key={r.retroverse_album_id}>
                            <td>
                              <RvalLink id={r.retroverse_album_id} />
                            </td>
                            <td>{r.canonical_album_title}</td>
                            <td>{r.artist_name}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="int-muted">No orphan samples (or none in first pass).</p>
                )}
                {a1.total_orphan_albums > a1.samples.length ? (
                  <p className="int-muted">Showing first {a1.samples.length} samples.</p>
                ) : null}
              </>
            )}
          </section>

          <section className="int-card">
            <h2>
              <Sev s={a2.severity} />
              Audit 2 — Duplicate title clusters
            </h2>
            <p className="int-meta">{a2.note}</p>
            <p>
              <strong>Clusters:</strong> {a2.cluster_count.toLocaleString()}
              {a2.clusters.length < a2.cluster_count ? (
                <span className="int-muted"> · table: first {a2.clusters.length}</span>
              ) : null}
            </p>
            {a2.clusters.length === 0 ? (
              <p className="int-muted">No clusters in heuristic window.</p>
            ) : (
              a2.clusters.map((c, i) => (
                <div key={`${c.artist_id}-${c.normalized_title}-${i}`} style={{ marginTop: "0.85rem" }}>
                  <div>
                    <strong>{c.artist_name}</strong>
                    <span className="int-muted"> · norm title: {c.normalized_title || "—"}</span>
                  </div>
                  <div className="int-table-wrap">
                    <table className="int-table">
                      <thead>
                        <tr>
                          <th>RVAL</th>
                          <th>Title</th>
                          <th>Release year</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.albums.map((a) => (
                          <tr key={a.retroverse_album_id}>
                            <td>
                              <RvalLink id={a.retroverse_album_id} />
                            </td>
                            <td>{a.title}</td>
                            <td>{a.release_year ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            )}
          </section>

          <section className="int-card">
            <h2>
              <Sev s={a3.severity} />
              Audit 3 — Split chart histories
            </h2>
            <p className="int-meta">{a3.note}</p>
            {a3.skipped ? (
              <p className="int-warn-inline">Skipped. {a3.skip_reason}</p>
            ) : (
              <>
                <p>
                  <strong>Clusters:</strong> {a3.cluster_count.toLocaleString()}
                </p>
                {a3.clusters.length === 0 ? (
                  <p className="int-muted">No split-history candidates in heuristic window.</p>
                ) : null}
              </>
            )}
            {!a3.skipped && a3.clusters.length > 0 ? (
              a3.clusters.map((c, i) => (
                <div key={`split-${c.normalized_artist}-${c.normalized_title}-${i}`} style={{ marginTop: "0.85rem" }}>
                  <div className="int-muted">
                    norm artist: {c.normalized_artist || "—"} · norm title: {c.normalized_title || "—"}
                  </div>
                  <div className="int-table-wrap">
                    <table className="int-table">
                      <thead>
                        <tr>
                          <th>RVAL</th>
                          <th>Title</th>
                          <th>Artist</th>
                          <th>Weeks</th>
                          <th>First</th>
                          <th>Last</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.albums.map((a) => (
                          <tr key={a.retroverse_album_id}>
                            <td>
                              <RvalLink id={a.retroverse_album_id} />
                            </td>
                            <td>{a.title}</td>
                            <td>{a.artist_name}</td>
                            <td>{a.chart_weeks}</td>
                            <td>{a.first_chart_date}</td>
                            <td>{a.last_chart_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
            ) : null}
          </section>

          <section className="int-card">
            <h2>
              <Sev s={a4.severity} />
              Audit 4 — Chronology violations
            </h2>
            <p className="int-meta">{a4.note}</p>
            {a4.skipped ? (
              <p className="int-warn-inline">Skipped. {a4.skip_reason}</p>
            ) : (
              <>
                <p>
                  <strong>Violations (total in scan):</strong> {a4.violation_count.toLocaleString()}
                  <span className="int-muted"> · albums checked: {a4.albums_checked.toLocaleString()}</span>
                </p>
                {a4.violations.length === 0 ? (
                  <p className="int-muted">None in scan window.</p>
                ) : (
                  <div className="int-table-wrap">
                    <table className="int-table">
                      <thead>
                        <tr>
                          <th>RVAL</th>
                          <th>Album</th>
                          <th>Artist</th>
                          <th>Release year</th>
                          <th>Earliest chart week</th>
                          <th>Δ (years)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a4.violations.map((v) => (
                          <tr key={v.retroverse_album_id}>
                            <td>
                              <RvalLink id={v.retroverse_album_id} />
                            </td>
                            <td>{v.title}</td>
                            <td>{v.artist_name}</td>
                            <td>{v.release_year}</td>
                            <td>{v.earliest_chart_date}</td>
                            <td>{v.years_before_release}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {a4.violation_count > a4.violations.length ? (
                  <p className="int-muted">Table shows first {a4.violations.length} samples.</p>
                ) : null}
              </>
            )}
          </section>

          <section className="int-card">
            <h2>
              <Sev s={audit5.severity} />
              Audit 5 — Canonical spine
            </h2>
            {audit5.skipped ? (
              <p className="int-warn-inline">Skipped. {audit5.skip_reason}</p>
            ) : (
              <>
                <p className="int-meta">
                  canonical_album_chart_runs scan: {a5.rows_scanned.toLocaleString()} rows
                  {a5.scan_capped ? " (capped)" : ""}.
                </p>
                <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem" }}>
                  <li>
                    <strong>Duplicate (album, week)</strong> extra row count: {a5.duplicate_week_rows.toLocaleString()}
                  </li>
                  <li>
                    <strong>Invalid position</strong> (null / NaN / outside 1–200):{" "}
                    {a5.invalid_position_rows.toLocaleString()}
                  </li>
                  <li>
                    <strong>Null / missing keys</strong> (album id, date, or position):{" "}
                    {a5.null_key_rows.toLocaleString()}
                  </li>
                </ul>
                {a5.duplicate_week_samples.length > 0 ? (
                  <>
                    <p style={{ margin: "0.75rem 0 0.25rem" }}>Duplicate week samples</p>
                    <div className="int-table-wrap">
                      <table className="int-table">
                        <thead>
                          <tr>
                            <th>RVAL</th>
                            <th>chart_date</th>
                            <th>position (first seen)</th>
                            <th>row_count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a5.duplicate_week_samples.map((s, idx) => (
                            <tr key={`${s.retroverse_album_id}-${s.chart_date}-${idx}`}>
                              <td>
                                <RvalLink id={s.retroverse_album_id} />
                              </td>
                              <td>{s.chart_date}</td>
                              <td>{s.chart_position}</td>
                              <td>{s.row_count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
                {a5.invalid_position_samples.length > 0 ? (
                  <>
                    <p style={{ margin: "0.75rem 0 0.25rem" }}>Invalid / null key samples</p>
                    <div className="int-table-wrap">
                      <table className="int-table">
                        <thead>
                          <tr>
                            <th>RVAL</th>
                            <th>chart_date</th>
                            <th>chart_position</th>
                          </tr>
                        </thead>
                        <tbody>
                          {a5.invalid_position_samples.map((s, idx) => (
                            <tr key={`inv-${s.retroverse_album_id}-${s.chart_date}-${idx}`}>
                              <td>
                                <RvalLink id={s.retroverse_album_id} />
                              </td>
                              <td>{s.chart_date}</td>
                              <td>{s.chart_position === null ? "null" : String(s.chart_position)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : null}
              </>
            )}
          </section>

          <p className="int-muted">
            Heuristics album window: first {data.albums_scanned_for_heuristics.toLocaleString()} / cap{" "}
            {data.heuristics_cap.toLocaleString()} by retroverse_album_id.
          </p>
        </>
      ) : null}
    </>
  );
}
