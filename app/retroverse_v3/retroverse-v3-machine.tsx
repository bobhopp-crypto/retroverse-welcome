"use client";

import Link from "next/link";
import type { CSSProperties, PointerEvent } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildNeighborCellMatrix,
  contextualNeighborsInObservation,
  culturalZoneDepthOrderedIds,
} from "./chart-neighborhood";
import { buildTrailFieldPresentation } from "./occupancy-field-render";
import {
  activeTemporalDomain,
  buildReentryGhostSegments,
  computeTemporalDomains,
  domainTimelineTicks,
  type SemanticRunKind,
} from "./semantic-run";
import type { Trail } from "./types";
import {
  CHART_NEIGHBORHOOD_SPAN_YEARS,
  formatObservationRangeLabel,
  MIN_OBSERVATION_SPAN_YEARS,
  observationScaleLabel,
  renderZoomFromSpan,
} from "./temporal-window";
import { SIGNAL_GLOBAL_END, SIGNAL_GLOBAL_START } from "./occupancy-scope";

type DepthRange = { label: string; min: number; max: number };
type Coordinate = { col: number; row: number };
type PanelMode = "idle" | "signalInspect" | "coverInspect";

const GLOBAL_START = SIGNAL_GLOBAL_START;
const GLOBAL_END = SIGNAL_GLOBAL_END;
const COLS = 5;
const DEPTH_ROWS = 6;

const depthRanges: DepthRange[] = [
  { label: "Top 10", min: 1, max: 10 },
  { label: "11-25", min: 11, max: 25 },
  { label: "26-40", min: 26, max: 40 },
  { label: "41-60", min: 41, max: 60 },
  { label: "61-100", min: 61, max: 100 },
  { label: "101-200", min: 101, max: 200 },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function depthToY(position: number) {
  const p = clamp(position, 1, 200);
  for (let i = 0; i < depthRanges.length; i++) {
    const range = depthRanges[i];
    if (p >= range.min && p <= range.max) {
      const within = (p - range.min) / Math.max(1, range.max - range.min);
      return ((i + within) / depthRanges.length) * 100;
    }
  }
  return 99;
}

function depthRowForPosition(position: number) {
  const p = clamp(position, 1, 200);
  for (let i = 0; i < depthRanges.length; i++) {
    const range = depthRanges[i];
    if (p >= range.min && p <= range.max) return i;
  }
  return depthRanges.length - 1;
}

function formatColumnLabel(start: number, span: number) {
  if (span >= 1.5) return `${Math.round(start)}`;
  if (span >= 0.5) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthIndex = clamp(Math.floor((start - Math.floor(start)) * 12), 0, 11);
    return `${months[monthIndex]} '${String(Math.floor(start)).slice(2)}`;
  }
  const weekIndex = Math.max(1, Math.round((start - Math.floor(start)) * 52));
  return `Wk ${weekIndex}`;
}

function trailMedianYear(trail: Trail): number {
  if (trail.points.length === 0) return (GLOBAL_START + GLOBAL_END) / 2;
  const ys = trail.points.map((p) => p.yearFloat).sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)] ?? ys[0];
}

function trailMedianDepth(trail: Trail): number {
  if (trail.points.length === 0) return 50;
  const ps = trail.points.map((p) => p.position).sort((a, b) => a - b);
  return ps[Math.floor(ps.length / 2)] ?? ps[0] ?? 50;
}

function emptyTrail(): Trail {
  return {
    id: "empty",
    title: "No signal",
    artist: "—",
    color: "#f4b758",
    cover: { sky: "#23303e", ground: "#a9502a", sun: "#f0bb55" },
    points: [],
    archiveHref: "/search",
    artistHref: "/search",
    releaseYear: null,
    source: "canonical",
  };
}

function initialTunedId(trails: Trail[]): string | null {
  if (trails.length === 0) return null;
  const rumours = trails.find((t) => /rumou?rs/i.test(t.title));
  return (rumours ?? trails[0]).id;
}

export default function RetroverseV3Machine({ initialTrails }: { initialTrails: Trail[] }) {
  const trails = initialTrails;
  const trailsById = useMemo(() => new Map(trails.map((t) => [t.id, t])), [trails]);

  const [tunedTrailId, setTunedTrailId] = useState<string | null>(() => initialTunedId(trails));
  const [semanticControl, setSemanticControl] = useState<SemanticRunKind>("canon");
  const [panelMode, setPanelMode] = useState<PanelMode>("idle");
  const [signalOpen, setSignalOpen] = useState(false);
  const [signalQuery, setSignalQuery] = useState("");

  const resolvedTunedId = useMemo(() => {
    if (trails.length === 0) return null;
    if (tunedTrailId && trailsById.has(tunedTrailId)) return tunedTrailId;
    return initialTunedId(trails);
  }, [trails, trailsById, tunedTrailId]);

  const sortedIdsByTime = useMemo(
    () => [...trails].sort((a, b) => trailMedianYear(a) - trailMedianYear(b)).map((t) => t.id),
    [trails],
  );
  const sortedIdsByDepth = useMemo(
    () => [...trails].sort((a, b) => trailMedianDepth(a) - trailMedianDepth(b)).map((t) => t.id),
    [trails],
  );

  const signalHoldTimer = useRef<number | null>(null);
  const coverHoldTimer = useRef<number | null>(null);
  const suppressCellClick = useRef(false);
  const signalInputRef = useRef<HTMLInputElement | null>(null);

  const swipeRef = useRef<{
    x: number;
    y: number;
    pointerId: number;
    active: boolean;
  } | null>(null);

  const tunedTrail = useMemo<Trail>(() => {
    if (!resolvedTunedId) return emptyTrail();
    return trailsById.get(resolvedTunedId) ?? emptyTrail();
  }, [resolvedTunedId, trailsById]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (tunedTrail.source === "synthetic" || tunedTrail.points.length === 0) return;
    const sorted = [...tunedTrail.points].sort((a, b) => a.yearFloat - b.yearFloat);
    const peak = Math.min(...tunedTrail.points.map((p) => p.position));
    console.log("[retroscope:canonical]", {
      retroverse_album_id: tunedTrail.id,
      chart_weeks: tunedTrail.points.length,
      first_chart_week_year_float: sorted[0]?.yearFloat,
      last_chart_week_year_float: sorted[sorted.length - 1]?.yearFloat,
      peak_chart_position: peak,
    });
  }, [tunedTrail]);

  const temporalDomains = useMemo(() => computeTemporalDomains(tunedTrail), [tunedTrail]);

  const activeDomain = useMemo(
    () => activeTemporalDomain(semanticControl, temporalDomains),
    [semanticControl, temporalDomains],
  );

  const visibleStart = activeDomain.start;
  const visibleEnd = activeDomain.end;
  const visibleSpan = Math.max(MIN_OBSERVATION_SPAN_YEARS, visibleEnd - visibleStart);
  const renderZoom = renderZoomFromSpan(visibleSpan);
  const neighborhoodPhase =
    visibleSpan < CHART_NEIGHBORHOOD_SPAN_YEARS * 1.35
      ? Math.min(1, (CHART_NEIGHBORHOOD_SPAN_YEARS * 1.35 - visibleSpan) / (CHART_NEIGHBORHOOD_SPAN_YEARS * 0.85))
      : 0;

  const columnSpan = visibleSpan / COLS;

  const columnStarts = useMemo(
    () => Array.from({ length: COLS }, (_, i) => visibleStart + i * columnSpan),
    [visibleStart, columnSpan],
  );

  const contextualSatellites = useMemo(() => {
    if (renderZoom < 2 || renderZoom > 4 || trails.length < 2) return [];
    return contextualNeighborsInObservation(tunedTrail, trails, visibleStart, visibleEnd, 4);
  }, [renderZoom, trails, tunedTrail, visibleStart, visibleEnd]);

  const culturalZoneDepthIds = useMemo(() => {
    if (renderZoom < 2 || renderZoom > 4) return null;
    const ids = culturalZoneDepthOrderedIds(trails, visibleStart, visibleEnd);
    return ids.length > 0 ? ids : null;
  }, [renderZoom, trails, visibleStart, visibleEnd]);

  const cellNeighborMatrix = useMemo(() => {
    if (visibleSpan >= CHART_NEIGHBORHOOD_SPAN_YEARS || trails.length < 2) return null;
    return buildNeighborCellMatrix(COLS, DEPTH_ROWS, columnStarts, columnSpan, trails, resolvedTunedId, 3);
  }, [visibleSpan, trails, resolvedTunedId, columnStarts, columnSpan]);

  const telemetryLocator = useMemo((): Coordinate => {
    const col = 2;
    if (tunedTrail.points.length === 0) return { col, row: 2 };
    const tMid = columnStarts[col]! + columnSpan / 2;
    let best = tunedTrail.points[0]!;
    let bestAbs = Infinity;
    for (const p of tunedTrail.points) {
      const d = Math.abs(p.yearFloat - tMid);
      if (d < bestAbs) {
        bestAbs = d;
        best = p;
      }
    }
    return { col, row: depthRowForPosition(best.position) };
  }, [tunedTrail, columnStarts, columnSpan]);

  const trailPresentation = useMemo(
    () =>
      buildTrailFieldPresentation(
        renderZoom,
        tunedTrail.points,
        visibleStart,
        visibleEnd,
        visibleSpan,
        depthToY,
      ),
    [renderZoom, tunedTrail.points, visibleStart, visibleEnd, visibleSpan],
  );

  const reentryGhostSegments = useMemo(() => {
    if (
      (semanticControl !== "full" && semanticControl !== "canon") ||
      !temporalDomains.reentryPoints
    )
      return [];
    return buildReentryGhostSegments(
      temporalDomains.reentryPoints,
      visibleStart,
      visibleEnd,
      depthToY,
    );
  }, [semanticControl, temporalDomains.reentryPoints, visibleStart, visibleEnd]);

  const timelineTicks = useMemo(() => {
    const n = visibleSpan >= 42 ? 5 : visibleSpan >= 9 ? 4 : 3;
    return domainTimelineTicks(visibleStart, visibleEnd, n);
  }, [visibleStart, visibleEnd, visibleSpan]);

  const {
    mode: trailFieldMode,
    linePreset: trailLinePreset,
    heatBlobs: trailHeatBlobs,
    segments: trailSegments,
    mistSegments: trailMistSegments,
    dots: trailDots,
  } = trailPresentation;

  const tunedTrailStats = useMemo(() => {
    if (tunedTrail.points.length === 0) return { years: 0, peak: 0, span: "—", depthLabel: "—" };
    let minYear = Infinity;
    let maxYear = -Infinity;
    let peak = Infinity;
    let sumP = 0;
    for (const point of tunedTrail.points) {
      const year = Math.floor(point.yearFloat);
      if (year < minYear) minYear = year;
      if (year > maxYear) maxYear = year;
      if (point.position < peak) peak = point.position;
      sumP += point.position;
    }
    const medianP = sumP / tunedTrail.points.length;
    const depthRow = depthRowForPosition(medianP);
    return {
      years: maxYear - minYear + 1,
      peak,
      span: `${minYear}-${maxYear}`,
      depthLabel: depthRanges[depthRow]?.label ?? "—",
    };
  }, [tunedTrail]);

  const signalMatches = useMemo(() => {
    const query = signalQuery.trim().toLowerCase();
    if (query.length === 0) return trails.slice(0, 6);
    return trails
      .filter((t) => t.title.toLowerCase().includes(query) || t.artist.toLowerCase().includes(query))
      .slice(0, 8);
  }, [signalQuery, trails]);

  const selectTunedEntity = useCallback((id: string | null) => {
    if (!id) return;
    setTunedTrailId(id);
    setSemanticControl("canon");
    setPanelMode("idle");
    setSignalOpen(false);
    setSignalQuery("");
  }, []);

  const pickTrailAtCell = useCallback(
    (col: number, row: number): Trail | null => {
      if (trails.length === 0) return null;
      const yearCenter = columnStarts[col] + columnSpan / 2;
      const depthMid = (depthRanges[row].min + depthRanges[row].max) / 2;
      let best: Trail | null = null;
      let bestScore = Infinity;
      for (const trail of trails) {
        for (const p of trail.points) {
          const dy = Math.abs(p.yearFloat - yearCenter) / Math.max(columnSpan * 0.55, 0.15);
          const dd = Math.abs(p.position - depthMid) / 45;
          const score = dy * dy + dd * dd;
          if (score < bestScore) {
            bestScore = score;
            best = trail;
          }
        }
      }
      return best;
    },
    [trails, columnStarts, columnSpan],
  );

  const stepTunedByTime = useCallback(
    (dir: 1 | -1) => {
      if (sortedIdsByTime.length === 0) return;
      const current = resolvedTunedId;
      if (!current) return;
      const idx = sortedIdsByTime.indexOf(current);
      const base = idx === -1 ? 0 : idx;
      const next = clamp(base + dir, 0, sortedIdsByTime.length - 1);
      const id = sortedIdsByTime[next];
      if (id) {
        setTunedTrailId(id);
        setSemanticControl("canon");
      }
      setPanelMode("idle");
    },
    [sortedIdsByTime, resolvedTunedId],
  );

  const stepTunedByDepth = useCallback(
    (dir: 1 | -1) => {
      if (culturalZoneDepthIds && culturalZoneDepthIds.length > 0) {
        const current = resolvedTunedId;
        if (!current) return;
        const idx = culturalZoneDepthIds.indexOf(current);
        if (idx !== -1) {
          const next = clamp(idx + dir, 0, culturalZoneDepthIds.length - 1);
          const id = culturalZoneDepthIds[next];
          if (id) {
            setTunedTrailId(id);
            setSemanticControl("canon");
          }
          setPanelMode("idle");
          return;
        }
      }
      if (sortedIdsByDepth.length === 0) return;
      const current = resolvedTunedId;
      if (!current) return;
      const idx = sortedIdsByDepth.indexOf(current);
      const base = idx === -1 ? 0 : idx;
      const next = clamp(base + dir, 0, sortedIdsByDepth.length - 1);
      const id = sortedIdsByDepth[next];
      if (id) {
        setTunedTrailId(id);
        setSemanticControl("canon");
      }
      setPanelMode("idle");
    },
    [culturalZoneDepthIds, sortedIdsByDepth, resolvedTunedId],
  );

  useEffect(() => {
    document.body.classList.add("rv3-prototype-body");
    return () => {
      document.body.classList.remove("rv3-prototype-body");
    };
  }, []);

  useEffect(() => {
    if (signalOpen) {
      const id = window.requestAnimationFrame(() => signalInputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [signalOpen]);

  const clearSignalHold = () => {
    if (signalHoldTimer.current) {
      window.clearTimeout(signalHoldTimer.current);
      signalHoldTimer.current = null;
    }
  };

  const clearCoverHold = () => {
    if (coverHoldTimer.current) {
      window.clearTimeout(coverHoldTimer.current);
      coverHoldTimer.current = null;
    }
  };

  const startSignalHold = () => {
    suppressCellClick.current = false;
    clearSignalHold();
    signalHoldTimer.current = window.setTimeout(() => {
      suppressCellClick.current = true;
      setPanelMode("signalInspect");
    }, 520);
  };

  const startCoverHold = () => {
    clearCoverHold();
    coverHoldTimer.current = window.setTimeout(() => {
      setPanelMode("coverInspect");
    }, 520);
  };

  const coverStyle = {
    "--rv3-cover-sky": tunedTrail.cover.sky,
    "--rv3-cover-ground": tunedTrail.cover.ground,
    "--rv3-cover-sun": tunedTrail.cover.sun,
  } as CSSProperties;

  const onCoverPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: true };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startCoverHold();
  };

  const onCoverPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!swipeRef.current?.active || swipeRef.current.pointerId !== e.pointerId) return;
    const dx = e.clientX - swipeRef.current.x;
    const dy = e.clientY - swipeRef.current.y;
    if (Math.hypot(dx, dy) > 12) clearCoverHold();
  };

  const onCoverPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    clearCoverHold();
    if (!swipeRef.current?.active || swipeRef.current.pointerId !== e.pointerId) {
      swipeRef.current = null;
      return;
    }
    const dx = e.clientX - swipeRef.current.x;
    const dy = e.clientY - swipeRef.current.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const threshold = 48;
    if (Math.max(adx, ady) >= threshold) {
      if (adx >= ady) {
        if (dx > 0) stepTunedByTime(1);
        else stepTunedByTime(-1);
      } else {
        if (dy > 0) stepTunedByDepth(1);
        else stepTunedByDepth(-1);
      }
    }
    swipeRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onCoverPointerCancel = () => {
    clearCoverHold();
    swipeRef.current = null;
  };

  return (
    <section className="rv3-app" aria-label="Retroscope instrument">
      <div className="rv3-device">
        <header className="rv3-masthead">
          <button
            className={`rv3-hardware-button${signalOpen ? " is-active" : ""}`}
            type="button"
            aria-label={signalOpen ? "Close signal finder" : "Open signal finder"}
            aria-expanded={signalOpen}
            onClick={() => setSignalOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
          <div className="rv3-masthead-brand">
            <p className="rv3-kicker">Retroverse</p>
            <h1 className="rv3-scope-logotype">Retroscope</h1>
          </div>
          <div className="rv3-status-lamp" aria-label="Instrument active" />
        </header>

        {signalOpen ? (
          <div className="rv3-signal-finder" role="dialog" aria-label="Signal finder">
            <label className="rv3-signal-label" htmlFor="rv3-signal-input">
              Find signal
            </label>
            <input
              id="rv3-signal-input"
              ref={signalInputRef}
              type="search"
              autoComplete="off"
              placeholder="Title, artist…"
              value={signalQuery}
              onChange={(ev) => setSignalQuery(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" && signalMatches[0]) selectTunedEntity(signalMatches[0].id);
                if (ev.key === "Escape") {
                  setSignalOpen(false);
                  setSignalQuery("");
                }
              }}
            />
            <ul className="rv3-signal-list">
              {signalMatches.length === 0 ? (
                <li className="rv3-signal-empty">No matching signals.</li>
              ) : (
                signalMatches.map((trail) => (
                  <li key={trail.id}>
                    <button type="button" onClick={() => selectTunedEntity(trail.id)}>
                      <span className="rv3-signal-title">{trail.title}</span>
                      <span className="rv3-signal-artist">{trail.artist}</span>
                    </button>
                  </li>
                ))
              )}
              {signalQuery.trim().length >= 2 ? (
                <li className="rv3-signal-archive">
                  <Link href={`/search?q=${encodeURIComponent(signalQuery.trim())}`}>Archive search →</Link>
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <section className="rv3-tuned-object" aria-label="Tuned entity">
          <div
            className="rv3-cover-tuning-surface"
            role="application"
            aria-label="Tuning surface: swipe horizontally through time; vertically through nearby signals in the active observation band"
            onPointerDown={onCoverPointerDown}
            onPointerMove={onCoverPointerMove}
            onPointerUp={onCoverPointerUp}
            onPointerCancel={onCoverPointerCancel}
          >
            <div className="rv3-cover-frame">
              {contextualSatellites.length > 0 ? (
                <div className="rv3-cover-satellites" aria-hidden>
                  {contextualSatellites.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`rv3-cover-satellite rv3-cover-satellite-${i}`}
                      style={
                        {
                          "--rv3-cover-sky": t.cover.sky,
                          "--rv3-cover-ground": t.cover.ground,
                          "--rv3-cover-sun": t.cover.sun,
                        } as CSSProperties
                      }
                      aria-label={`Tune nearby signal ${t.title}`}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        selectTunedEntity(t.id);
                      }}
                    />
                  ))}
                </div>
              ) : null}
              <div className="rv3-cover-art" style={coverStyle} aria-hidden>
                <div className="rv3-sun" />
                <div className="rv3-band-line rv3-band-line-a" />
                <div className="rv3-band-line rv3-band-line-b" />
                <div className="rv3-band-silhouette">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
          <div className="rv3-cover-copy">
            <p className="rv3-meta-label">
              {panelMode === "coverInspect"
                ? "Curator"
                : panelMode === "signalInspect"
                  ? "Signal field"
                  : "Tuned entity"}
            </p>
            <h2>{tunedTrail.title}</h2>
            <p className="rv3-cover-artist">{tunedTrail.artist}</p>
            <div className="rv3-readout-row">
              <span>{tunedTrailStats.span}</span>
              <span>Peak #{tunedTrailStats.peak === Infinity ? "—" : tunedTrailStats.peak}</span>
              <span>{tunedTrailStats.depthLabel}</span>
            </div>
            {panelMode === "signalInspect" ? (
              <nav className="rv3-action-strip" aria-label="Exploration actions">
                <Link href={`/search?q=${encodeURIComponent(`${tunedTrail.title} ${tunedTrail.artist}`)}`}>
                  Chart
                </Link>
                <Link href={`/search?q=${encodeURIComponent(tunedTrail.title)}`}>Playlist</Link>
                <Link href={tunedTrail.artistHref}>Artist</Link>
                <Link href="/eras">Era</Link>
                <Link href="/random">Related</Link>
              </nav>
            ) : null}
            {panelMode === "coverInspect" ? (
              <nav className="rv3-action-strip rv3-action-strip-cover" aria-label="Curator actions">
                <Link href="/internal/curator">Curate</Link>
                <Link href={tunedTrail.archiveHref}>Archive</Link>
                <Link href={tunedTrail.artistHref}>Artist</Link>
              </nav>
            ) : null}
          </div>
        </section>

        <section className="rv3-window-strip" aria-label="Observation window">
          <div
            className="rv3-window-readout"
            role="button"
            tabIndex={0}
            title="Dismiss overlays"
            onClick={() => setPanelMode("idle")}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === " ") {
                ev.preventDefault();
                setPanelMode("idle");
              }
            }}
          >
            <span className="rv3-window-range">
              {formatObservationRangeLabel(visibleStart, visibleEnd, visibleSpan)}
            </span>
            <span className="rv3-window-zoom" title="Active temporal domain (x-axis remapped to this span)">
              {observationScaleLabel(visibleSpan)}
            </span>
          </div>
          <div className="rv3-window-levers" role="toolbar" aria-label="Semantic chart-run controls">
            {(
              [
                { kind: "origin" as const, label: "ORIGIN", title: "Origin — first chart appearance", disabled: false },
                { kind: "run" as const, label: "RUN", title: "Primary chart run — main cultural occupancy", disabled: false },
                { kind: "peak" as const, label: "PEAK", title: "Peak — densest / strongest chart presence", disabled: false },
                {
                  kind: "return" as const,
                  label: "RETURN",
                  title: "Return — later re-entry echo (secondary presence)",
                  disabled: !temporalDomains.hasReturn,
                },
                { kind: "full" as const, label: "FULL", title: "Full signal — entire historical occupancy", disabled: false },
              ] satisfies ReadonlyArray<{ kind: SemanticRunKind; label: string; title: string; disabled: boolean }>
            ).map((lv) => (
              <button
                key={lv.kind}
                type="button"
                className={`rv3-semantic-lever${semanticControl === lv.kind ? " is-active" : ""}${lv.disabled ? " is-disabled" : ""}`}
                title={lv.title}
                aria-pressed={semanticControl === lv.kind}
                disabled={lv.disabled}
                onClick={() => {
                  setSemanticControl(lv.kind);
                  setPanelMode("idle");
                }}
              >
                {lv.label}
              </button>
            ))}
          </div>
          <div className="rv3-window-track" aria-hidden>
            <div className="rv3-window-track-line" />
            <div className="rv3-window-track-markers">
              {timelineTicks.map((tick, i) => (
                <span key={`${tick}-${i}`}>{formatColumnLabel(tick, visibleSpan)}</span>
              ))}
            </div>
            <div className="rv3-window-bracket rv3-window-bracket-static" />
          </div>
        </section>

        <section className="rv3-occupancy-panel" aria-label="Signal field">
          <div className="rv3-grid-and-scale">
            <div
              className="rv3-grid"
              data-zoom={renderZoom}
              data-semantic={semanticControl}
              data-neighborhood-phase={neighborhoodPhase.toFixed(3)}
              style={{ "--rv3-nb": neighborhoodPhase } as CSSProperties}
            >
              <svg
                className="rv3-grid-trail"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
                data-trail-mode={trailFieldMode}
                data-line-preset={trailLinePreset}
              >
                <defs>
                  <filter
                    id="rv3-trail-heat-bloom"
                    x="-80%"
                    y="-80%"
                    width="260%"
                    height="260%"
                    colorInterpolationFilters="sRGB"
                  >
                    <feGaussianBlur in="SourceGraphic" stdDeviation="1.35" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {trailHeatBlobs?.map((h) => (
                  <ellipse
                    key={h.key}
                    className="rv3-grid-trail-heat"
                    cx={h.cx}
                    cy={h.cy}
                    rx={h.rx}
                    ry={h.ry}
                    opacity={h.opacity}
                    filter="url(#rv3-trail-heat-bloom)"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {trailMistSegments.map((seg) => (
                  <Fragment key={seg.key}>
                    <polyline
                      className="rv3-grid-trail-mist-glow"
                      points={seg.points}
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      className="rv3-grid-trail-mist-line"
                      points={seg.points}
                      vectorEffect="non-scaling-stroke"
                    />
                  </Fragment>
                ))}
                {trailSegments.map((seg) => (
                  <Fragment key={seg.key}>
                    <polyline
                      className="rv3-grid-trail-glow"
                      points={seg.points}
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      className="rv3-grid-trail-line"
                      points={seg.points}
                      vectorEffect="non-scaling-stroke"
                    />
                  </Fragment>
                ))}
                {trailDots.map((p, i) => (
                  <circle
                    key={`${p.year}-${i}`}
                    className="rv3-grid-trail-dot"
                    cx={p.x}
                    cy={p.y}
                    r={p.r}
                    opacity={p.opacity}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {reentryGhostSegments.map((seg) => (
                  <Fragment key={seg.key}>
                    <polyline
                      className="rv3-grid-trail-reentry-glow"
                      points={seg.points}
                      vectorEffect="non-scaling-stroke"
                    />
                    <polyline
                      className="rv3-grid-trail-reentry-line"
                      points={seg.points}
                      vectorEffect="non-scaling-stroke"
                    />
                  </Fragment>
                ))}
              </svg>
              <div className="rv3-grid-cells">
                {depthRanges.map((depth, row) => (
                  <div className="rv3-grid-row" key={depth.label}>
                    {columnStarts.map((start, col) => {
                      const isTelemetry = telemetryLocator.col === col && telemetryLocator.row === row;
                      return (
                        <button
                          className={`rv3-cell${isTelemetry ? " is-active" : ""}`}
                          key={`${depth.label}-${col}`}
                          type="button"
                          aria-label={`Signal field ${formatColumnLabel(start, visibleSpan)} · ${depth.label}`}
                          onClick={() => {
                            if (suppressCellClick.current) {
                              suppressCellClick.current = false;
                              return;
                            }
                            const hit = pickTrailAtCell(col, row);
                            if (hit) selectTunedEntity(hit.id);
                            setPanelMode("idle");
                          }}
                          onPointerDown={() => {
                            startSignalHold();
                          }}
                          onPointerUp={() => {
                            clearSignalHold();
                          }}
                          onPointerLeave={() => {
                            clearSignalHold();
                          }}
                        >
                          {cellNeighborMatrix?.[row]?.[col]?.length ? (
                            <span
                              className="rv3-cell-chart-adjacency"
                              style={{ opacity: neighborhoodPhase }}
                              aria-hidden
                            >
                              {cellNeighborMatrix[row]![col]!.map((n) => (
                                <span
                                  key={n.id}
                                  className="rv3-cell-chart-chip"
                                  style={
                                    {
                                      "--rv3-chip-sky": n.cover.sky,
                                      "--rv3-chip-ground": n.cover.ground,
                                      "--rv3-chip-sun": n.cover.sun,
                                    } as CSSProperties
                                  }
                                  title={`${n.title} · ${n.artist}`}
                                />
                              ))}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            <aside className="rv3-depth-scale" aria-label="Chart depth">
              {depthRanges.map((depth) => (
                <span key={depth.label}>{depth.label}</span>
              ))}
            </aside>

            <div className="rv3-grid-x-axis" aria-hidden>
              {columnStarts.map((start) => (
                <span key={start}>{formatColumnLabel(start, visibleSpan)}</span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
