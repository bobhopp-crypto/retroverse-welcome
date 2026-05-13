"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { humanWorkflowCalibrationSummary } from "../review/calibration-workflow";
import type { CalibrationTierId } from "../review/calibration-tiers";
import type { AlbumReviewPipelineDiagnostics, CandidateBreakdown, ReviewRow } from "../review/load-review-data";
import {
  computeTrackOverlapSignal,
  trackOverlapHeadline,
  trackOverlapUiTier,
} from "../review/track-overlap";
import type { CalibrationTierQueues } from "./load-queue";

type Props = {
  queues: CalibrationTierQueues;
  pipeline: AlbumReviewPipelineDiagnostics;
};

type Preview = {
  artworkUrl: string | null;
  releaseYear: number | null;
  collectionId: string | null;
  artworkSourceField?: string | null;
};

const CANDIDATE_POOL = 12;
const MAX_STRIP_SLOTS = 4;
const DECISION_FLASH_MS = 300;
/** Matches server ESCALATION_STRATEGIES length (finite retrieval attempts before Discogs lane). */
const ESCALATION_TOTAL = 4;

/** Per-queue-row UI session (survives NEXT/PREVIOUS; backs preview cache). */
type RowUiPersisted = {
  focus: number;
  discogsPaste: string;
  discogsMsg: string | null;
  previews: Preview[] | null;
  poolFp: string;
  artDbg: Record<string, unknown> | null;
};

function poolFingerprint(pool: CandidateBreakdown[]): string {
  return pool.map((c) => `${c.candidateArtist}\t${c.candidateAlbum}`).join("\n");
}

function clampCandidateFocus(f: number, poolLen: number): number {
  if (poolLen <= 0) return -1;
  if (f < -1) return -1;
  if (f >= poolLen) return -1;
  return f;
}

function pickPreviewsToStore(
  rowId: string,
  candidatePool: CandidateBreakdown[],
  previews: Preview[],
  fp: string,
  cur: RowUiPersisted | undefined,
  /** React state `previews` only reused when it was produced for this row (same pool size is not enough). */
  previewsOwnerRowId: string | null,
): Preview[] | null {
  const n = candidatePool.length;
  if (n > 0 && previews.length === n && previewsOwnerRowId === rowId) return previews;
  if (cur?.poolFp === fp && cur.previews && cur.previews.length === n) return cur.previews;
  return cur?.poolFp === fp ? cur.previews : null;
}

const ITUNES_ART_DEBUG =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_ITUNES_ART_DEBUG === "1";

function heroCover(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/60x60bb/g, "1200x1200bb")
    .replace(/100x100bb/g, "1200x1200bb")
    .replace(/200x200bb/g, "1200x1200bb")
    .replace(/600x600bb/g, "1200x1200bb");
}

function thumbLarge(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/60x60bb/g, "600x600bb")
    .replace(/100x100bb/g, "600x600bb")
    .replace(/200x200bb/g, "600x600bb");
}

/** Alternate strip: larger than sidebar thumbs. */
function thumbStrip(url: string | null): string | null {
  if (!url) return null;
  return url
    .replace(/60x60bb/g, "800x800bb")
    .replace(/100x100bb/g, "800x800bb")
    .replace(/200x200bb/g, "800x800bb")
    .replace(/600x600bb/g, "800x800bb");
}

/** Calibration: prefer direct CDN URL (600) without 1200 upscale — easier to verify pipeline. */
function heroUrlForDisplay(raw: string | null): string | null {
  if (!raw) return null;
  if (ITUNES_ART_DEBUG) return thumbLarge(raw);
  return heroCover(raw);
}

function fmtScore(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(3);
}

function penaltySummary(c: CandidateBreakdown | null): string {
  if (!c) return "—";
  const parts: string[] = [];
  if ((c.compilationPenalty ?? 0) > 0) parts.push(`comp ${c.compilationPenalty}`);
  if ((c.remasterPenalty ?? 0) > 0) parts.push(`rem ${c.remasterPenalty}`);
  if ((c.tributePenalty ?? 0) > 0) parts.push(`trib ${c.tributePenalty}`);
  if ((c.karaokePenalty ?? 0) > 0) parts.push(`kara ${c.karaokePenalty}`);
  if ((c.singlePenalty ?? 0) > 0) parts.push(`single ${c.singlePenalty}`);
  if ((c.epPenalty ?? 0) > 0) parts.push(`ep ${c.epPenalty}`);
  return parts.length ? parts.join(" · ") : "none";
}

function externalSearchQuery(artist: string, album: string): string {
  return `${artist} ${album}`.replace(/\s+/g, " ").trim();
}

function discogsSearchUrl(artist: string, album: string): string {
  return `https://www.discogs.com/search/?q=${encodeURIComponent(externalSearchQuery(artist, album))}&type=all`;
}

function sameCandidate(a: CandidateBreakdown | null, b: CandidateBreakdown | null): boolean {
  if (!a || !b) return false;
  return (
    a.candidateArtist.trim() === b.candidateArtist.trim() && a.candidateAlbum.trim() === b.candidateAlbum.trim()
  );
}

/** Global shortcuts only; skip while user is typing in a field. */
function keyboardTargetBlocksShortcuts(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const TIER_CONTROLS: { id: CalibrationTierId; label: string }[] = [
  { id: "easy", label: "EASY WINS" },
  { id: "calibration", label: "CALIBRATION" },
  { id: "hard", label: "HARD FAILURES" },
];

export function AlbumReviewClient({ queues, pipeline }: Props) {
  const router = useRouter();
  const persisted = useRef<Map<string, RowUiPersisted>>(new Map());
  /** Guards sync/flush so row B never inherits row A's preview array when |pool| matches. */
  const previewsOwnerRowIdRef = useRef<string | null>(null);
  const queuesRef = useRef(queues);
  queuesRef.current = queues;
  const activeTierRef = useRef<CalibrationTierId>("easy");
  const [activeTier, setActiveTier] = useState<CalibrationTierId>("easy");
  activeTierRef.current = activeTier;

  const [qiByTier, setQiByTier] = useState<Record<CalibrationTierId, number>>({
    easy: 0,
    calibration: 0,
    hard: 0,
  });

  const [throughput, setThroughput] = useState<
    Record<CalibrationTierId, { useThis: number; tryAgain: number; skip: number }>
  >({
    easy: { useThis: 0, tryAgain: 0, skip: 0 },
    calibration: { useThis: 0, tryAgain: 0, skip: 0 },
    hard: { useThis: 0, tryAgain: 0, skip: 0 },
  });

  const [focus, setFocus] = useState<number>(-1);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [artDbg, setArtDbg] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<"discogs" | null>(null);
  const [rerunLog, setRerunLog] = useState<string | null>(null);
  const [discogsPaste, setDiscogsPaste] = useState("");
  const [discogsMsg, setDiscogsMsg] = useState<string | null>(null);
  const [decisionFlash, setDecisionFlash] = useState<null | "use_this" | "try_again" | "skip">(null);
  const [postingDecision, setPostingDecision] = useState(false);

  const initialQueue = useMemo(() => queues[activeTier], [queues, activeTier]);
  const qi = qiByTier[activeTier];

  const row = initialQueue[qi] ?? null;

  const candidatePool = useMemo(() => {
    if (!row) return [];
    return row.candidates.slice(0, CANDIDATE_POOL);
  }, [row]);

  const candidatePoolFp = useMemo(() => poolFingerprint(candidatePool), [candidatePool]);

  useEffect(() => {
    const len = initialQueue.length;
    setQiByTier((prev) => {
      const q = prev[activeTier];
      if (len === 0) return { ...prev, [activeTier]: 0 };
      if (q >= len) return { ...prev, [activeTier]: Math.max(0, len - 1) };
      return prev;
    });
  }, [initialQueue.length, activeTier]);

  const pipelineCandidate = useMemo((): CandidateBreakdown | null => {
    if (!row) return null;
    const a = row.matchedArtist.trim();
    const b = row.matchedAlbum.trim();
    if (!a && !b) return row.candidates[0] ?? null;
    return (
      row.candidates.find((c) => c.candidateArtist.trim() === a && c.candidateAlbum.trim() === b) ??
      row.candidates[0] ??
      null
    );
  }, [row]);

  /** Alternates with artwork only (no blank slots). PRIMARY always first. */
  const stripFocusIndices = useMemo(() => {
    if (!row) return [] as number[];
    const slots: number[] = [-1];
    const rawPath = row.rawSnapshotPaths[0] ?? "";
    const poolLen = candidatePool.length;
    const previewsAligned = previews.length === poolLen;
    const canFilterBlanks = Boolean(rawPath) && previewsAligned && poolLen > 0;

    for (let i = 0; i < candidatePool.length && slots.length < MAX_STRIP_SLOTS; i++) {
      const c = candidatePool[i]!;
      if (sameCandidate(c, pipelineCandidate)) continue;
      if (!canFilterBlanks) continue;
      const art = thumbStrip(previews[i]?.artworkUrl ?? null);
      if (!art) continue;
      slots.push(i);
    }
    return slots;
  }, [row, candidatePool, pipelineCandidate, previews]);

  const focusedCandidate = useMemo((): CandidateBreakdown | null => {
    if (!row) return null;
    if (focus === -1) return pipelineCandidate;
    return candidatePool[focus] ?? null;
  }, [row, focus, pipelineCandidate, candidatePool]);

  const trackOverlapHint = useMemo(() => {
    if (!row || !focusedCandidate) return null;
    const sample = focusedCandidate.trackSample ?? [];
    const sig = computeTrackOverlapSignal({
      billboardArtist: row.billboardArtist,
      billboardAlbum: row.billboardAlbum,
      trackSample: sample,
      catalogTrackCount: focusedCandidate.itunesTrackCount,
    });
    const tier = trackOverlapUiTier(sig, sample.length > 0);
    return { headline: trackOverlapHeadline(tier), contains: sig.matchedSample };
  }, [row, focusedCandidate]);

  const flushRowPersist = useCallback(() => {
    if (!row) return;
    const fp = candidatePoolFp;
    const cur = persisted.current.get(row.id);
    const previewsSt = pickPreviewsToStore(
      row.id,
      candidatePool,
      previews,
      fp,
      cur,
      previewsOwnerRowIdRef.current,
    );
    persisted.current.set(row.id, {
      focus: clampCandidateFocus(focus, candidatePool.length),
      discogsPaste,
      discogsMsg,
      previews: previewsSt,
      poolFp: fp,
      artDbg,
    });
  }, [row, candidatePoolFp, candidatePool, focus, discogsPaste, discogsMsg, previews, artDbg]);

  const rawHeroArt = useMemo((): string | null => {
    if (!row) return null;
    if (focus === -1) return row.artworkUrl;
    const p = previews[focus];
    return p?.artworkUrl ?? row.artworkUrl;
  }, [row, focus, previews]);

  /** Resolved URL passed to `<img>` (debug → 600bb direct; otherwise 1200 hero). */
  const centerArt = useMemo(() => heroUrlForDisplay(rawHeroArt), [rawHeroArt]);

  const matchScoreDisplay = focus === -1 ? row?.finalScore : focusedCandidate?.finalScore;

  const rightReleaseYear = useMemo(() => {
    if (!row) return null;
    if (focus === -1) return row.matchedReleaseYear;
    return previews[focus]?.releaseYear ?? row.matchedReleaseYear;
  }, [row, focus, previews]);

  const calSummary = row ? humanWorkflowCalibrationSummary(row) : null;
  const showWorkflowOverlay = Boolean(calSummary && activeTier !== "easy");
  const isDiscogsLane = row ? row.calibrationQueueState === "DISCOGS_REVIEW" : false;
  const escStage = row?.calibrationEscalationStage ?? 0;

  /**
   * Row switch: restore operator fields + previews from in-memory map, or refetch candidate artwork.
   * Single effect avoids applying previous row's `previews` to the next row when pool sizes match.
   */
  useEffect(() => {
    if (!row) {
      setPreviews([]);
      setArtDbg(null);
      previewsOwnerRowIdRef.current = null;
      return;
    }
    const pool = row.candidates.slice(0, CANDIDATE_POOL);
    const fp = poolFingerprint(pool);
    const p = persisted.current.get(row.id);
    if (p) {
      setFocus(clampCandidateFocus(p.focus, pool.length));
      setDiscogsPaste(p.discogsPaste);
      setDiscogsMsg(p.discogsMsg);
    } else {
      setFocus(-1);
      setDiscogsPaste("");
      setDiscogsMsg(null);
    }
    const cacheOk = Boolean(
      p?.poolFp === fp && p.previews && p.previews.length === pool.length && pool.length > 0,
    );
    if (cacheOk && p?.previews) {
      setPreviews(p.previews);
      setArtDbg(p.artDbg ?? null);
      previewsOwnerRowIdRef.current = row.id;
      return;
    }
    const rawPath = row.rawSnapshotPaths[0] ?? "";
    if (!rawPath || pool.length === 0) {
      setPreviews(pool.map(() => ({ artworkUrl: null, releaseYear: null, collectionId: null })));
      setArtDbg(null);
      previewsOwnerRowIdRef.current = row.id;
      return;
    }
    const ac = new AbortController();
    setPreviews(pool.map(() => ({ artworkUrl: null, releaseYear: null, collectionId: null })));
    setArtDbg(null);
    previewsOwnerRowIdRef.current = row.id;
    fetch("/api/ops/itunes-album-review/candidate-details", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rawPath,
        candidates: pool.map((c) => ({
          candidateArtist: c.candidateArtist,
          candidateAlbum: c.candidateAlbum,
        })),
        debugArt: ITUNES_ART_DEBUG,
      }),
      signal: ac.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(await res.text());
        return res.json() as Promise<{ previews: Preview[]; _artDebug?: Record<string, unknown> }>;
      })
      .then((j) => {
        const list = j.previews ?? [];
        const pad = pool.map(
          (_, i): Preview =>
            list[i] ?? { artworkUrl: null, releaseYear: null, collectionId: null },
        );
        setPreviews(pad);
        setArtDbg(j._artDebug ?? null);
        previewsOwnerRowIdRef.current = row.id;
      })
      .catch(() => {
        setPreviews(pool.map(() => ({ artworkUrl: null, releaseYear: null, collectionId: null })));
        setArtDbg(null);
        previewsOwnerRowIdRef.current = row.id;
      });
    return () => ac.abort();
  }, [row?.id, candidatePoolFp, row?.rawSnapshotPaths]);

  const goNext = useCallback(() => {
    const t = activeTierRef.current;
    const q = queuesRef.current[t];
    if (q.length === 0 || decisionFlash !== null) return;
    flushRowPersist();
    setQiByTier((prev) => ({
      ...prev,
      [t]: (prev[t] + 1) % Math.max(1, q.length),
    }));
  }, [decisionFlash, flushRowPersist]);

  const goPrev = useCallback(() => {
    const t = activeTierRef.current;
    const q = queuesRef.current[t];
    if (q.length === 0 || decisionFlash !== null) return;
    flushRowPersist();
    setQiByTier((prev) => ({
      ...prev,
      [t]: (prev[t] - 1 + Math.max(1, q.length)) % Math.max(1, q.length),
    }));
  }, [decisionFlash, flushRowPersist]);

  useEffect(() => {
    if (!row) return;
    const fp = candidatePoolFp;
    const cur = persisted.current.get(row.id);
    const previewsSt = pickPreviewsToStore(
      row.id,
      candidatePool,
      previews,
      fp,
      cur,
      previewsOwnerRowIdRef.current,
    );
    persisted.current.set(row.id, {
      focus: clampCandidateFocus(focus, candidatePool.length),
      discogsPaste,
      discogsMsg,
      previews: previewsSt,
      poolFp: fp,
      artDbg,
    });
  }, [row?.id, focus, discogsPaste, discogsMsg, previews, candidatePool, candidatePoolFp, artDbg]);

  const openDiscogs = useCallback(() => {
    if (!row) return;
    window.open(discogsSearchUrl(row.billboardArtist, row.billboardAlbum), "_blank", "noopener,noreferrer");
  }, [row]);

  const saveDiscogsRecovery = useCallback(async () => {
    if (!row || !discogsPaste.trim()) return;
    setBusy("discogs");
    setDiscogsMsg(null);
    try {
      const res = await fetch("/api/ops/itunes-album-review/discogs-recovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: discogsPaste.trim(),
          billboardArtist: row.billboardArtist,
          billboardAlbum: row.billboardAlbum,
          chartYear: row.chartYear,
          rowId: row.id,
          workflowTier: activeTier,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        extracted?: { artistGuess?: string | null; albumGuess?: string | null; releaseYear?: number | null };
      };
      if (!res.ok) {
        setDiscogsMsg(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const eg = j.extracted;
      setDiscogsMsg(
        `Logged human-confirmed recovery · ${eg?.artistGuess ?? "?"} — ${eg?.albumGuess ?? "?"} (${eg?.releaseYear ?? "year?"})`,
      );
      setDiscogsPaste("");
      void router.refresh();
    } catch (e) {
      setDiscogsMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [row, discogsPaste, activeTier, router]);

  const postCalibrationAction = useCallback(
    async (action: "use_this" | "try_again" | "skip") => {
      if (!row || decisionFlash !== null || postingDecision) return;
      if (action === "try_again" && row.calibrationQueueState === "DISCOGS_REVIEW") return;

      const poolIdx = clampCandidateFocus(focus, candidatePool.length);
      const selectedArtist =
        focusedCandidate?.candidateArtist?.trim() ||
        row.matchedArtist.trim() ||
        row.billboardArtist.trim();
      const selectedAlbum =
        focusedCandidate?.candidateAlbum?.trim() ||
        row.matchedAlbum.trim() ||
        row.billboardAlbum.trim();
      const collectionId =
        poolIdx >= 0
          ? (previews[poolIdx]?.collectionId ?? "").trim() || row.matchedCollectionId.trim()
          : row.matchedCollectionId.trim();

      flushRowPersist();
      setPostingDecision(true);
      setRerunLog(null);

      const tier = activeTierRef.current;
      try {
        const res = await fetch("/api/ops/itunes-album-review/calibration-action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            billboardArtist: row.billboardArtist,
            billboardAlbum: row.billboardAlbum,
            chartYear: row.chartYear,
            workflowTier: tier,
            selectedArtist,
            selectedAlbum,
            matchedCollectionId: collectionId,
            focusSlot: poolIdx,
            matchScore: poolIdx === -1 ? row.finalScore : focusedCandidate?.finalScore ?? null,
            artistSimilarity: focusedCandidate?.artistMatchScore ?? null,
            albumSimilarity: focusedCandidate?.albumMatchScore ?? null,
            tokenOverlap: focusedCandidate?.tokenOverlapScore ?? null,
            yearDistance: focusedCandidate?.releaseYearDistance ?? null,
            alternateSelected: poolIdx >= 0,
            pipelineRejectionReason: row.rejectionReason ?? "",
            reviewBucket: row.reviewBucket,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          log?: string;
          discogsLane?: boolean;
        };
        setPostingDecision(false);
        if (!res.ok) {
          setRerunLog(j.error || j.log || `HTTP ${res.status}`);
          return;
        }
        if (j.log) setRerunLog(j.log);

        setDecisionFlash(action === "use_this" ? "use_this" : action === "try_again" ? "try_again" : "skip");
        setThroughput((prev) => ({
          ...prev,
          [tier]: {
            useThis: prev[tier].useThis + (action === "use_this" ? 1 : 0),
            tryAgain: prev[tier].tryAgain + (action === "try_again" ? 1 : 0),
            skip: prev[tier].skip + (action === "skip" ? 1 : 0),
          },
        }));

        if (action === "use_this" || action === "try_again") {
          void router.refresh();
        }

        window.setTimeout(() => {
          setDecisionFlash(null);
          flushRowPersist();
          setQiByTier((prev) => {
            const q = queuesRef.current[tier];
            const len = Math.max(1, q.length);
            return { ...prev, [tier]: (prev[tier] + 1) % len };
          });
        }, DECISION_FLASH_MS);
      } catch (e) {
        setPostingDecision(false);
        setRerunLog(e instanceof Error ? e.message : String(e));
      }
    },
    [
      row,
      decisionFlash,
      postingDecision,
      focusedCandidate,
      focus,
      candidatePool.length,
      previews,
      flushRowPersist,
      router,
    ],
  );

  useEffect(() => {
    if (initialQueue.length === 0 || !row) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (keyboardTargetBlocksShortcuts(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (decisionFlash !== null || postingDecision) {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault();
        return;
      }

      switch (e.key) {
        case "ArrowRight": {
          e.preventDefault();
          goNext();
          return;
        }
        case "ArrowLeft": {
          e.preventDefault();
          goPrev();
          return;
        }
        case "1": {
          e.preventDefault();
          void postCalibrationAction("use_this");
          return;
        }
        case "2": {
          e.preventDefault();
          void postCalibrationAction("try_again");
          return;
        }
        case "3": {
          e.preventDefault();
          void postCalibrationAction("skip");
          return;
        }
        default:
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    initialQueue.length,
    row,
    decisionFlash,
    postingDecision,
    goNext,
    goPrev,
    postCalibrationAction,
  ]);

  const debugDetails = row && (
    <div className="space-y-4 font-mono text-sm leading-relaxed" style={{ color: "var(--cal-muted)" }}>
      {ITUNES_ART_DEBUG ? (
        <div>
          <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
            Artwork debug (NEXT_PUBLIC_ITUNES_ART_DEBUG)
          </span>
          <div style={{ color: "var(--cal-fg)" }}>focus: {focus} (−1 = pipeline)</div>
          <div className="break-all">row.artworkUrl: {row.artworkUrl ?? "null"}</div>
          <div className="break-all">rawHeroArt (pre-upscale): {rawHeroArt ?? "null"}</div>
          <div className="break-all">&lt;img&gt; src: {centerArt ?? "null"}</div>
          <div className="break-all">raw_snapshot_paths[0]: {row.rawSnapshotPaths[0] ?? "—"}</div>
          <div>
            previews w/ URL: {previews.filter((p) => p.artworkUrl).length}/{previews.length}
          </div>
          {focus >= 0 && previews[focus] ? (
            <div className="break-all">alt artworkSourceField: {previews[focus]?.artworkSourceField ?? "—"}</div>
          ) : null}
          {artDbg ? (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap opacity-90">{JSON.stringify(artDbg, null, 2)}</pre>
          ) : null}
        </div>
      ) : null}
      <div>
        <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
          Pipeline rejection code
        </span>
        <div style={{ color: "var(--cal-fg)" }}>{row.rejectionReason?.trim() || "—"}</div>
      </div>
      <div>
        <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
          Penalties (focused)
        </span>
        <div style={{ color: "var(--cal-fg)" }}>{penaltySummary(focusedCandidate)}</div>
      </div>
      <div>
        <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
          Normalization
        </span>
        <div>artist_key: {row.normalizedArtist || "—"}</div>
        <div>album_key: {row.normalizedAlbum || "—"}</div>
        {focusedCandidate && (
          <>
            <div>cand_artist_key: {focusedCandidate.normalizedCandidateArtist || "—"}</div>
            <div>cand_album_key: {focusedCandidate.normalizedCandidateAlbum || "—"}</div>
          </>
        )}
      </div>
      <div>
        <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
          Ranking (focused)
        </span>
        <div>
          artist_match {fmtScore(focusedCandidate?.artistMatchScore)} · album_match{" "}
          {fmtScore(focusedCandidate?.albumMatchScore)} · token {fmtScore(focusedCandidate?.tokenOverlapScore)} · year_dist{" "}
          {fmtScore(focusedCandidate?.yearDistanceScore)}
        </div>
        <div>
          track_overlap {fmtScore(focusedCandidate?.trackOverlapScore)} · itunes_track_count{" "}
          {focusedCandidate?.itunesTrackCount ?? "—"}
        </div>
        <div>historical_conf {fmtScore(focusedCandidate?.historicalConfidence)} · hist_penalty {focusedCandidate?.historicalPenaltyReason || "—"}</div>
        <div>rejected_reason: {focusedCandidate?.rejectedReason || "—"}</div>
      </div>
      <div>
        <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
          Last retrieval
        </span>
        <div>strategy: {row.fetchStrategyTaxonomy || "—"}</div>
        <div>retry_level: {row.retryStrategy || "—"}</div>
        <div className="break-all">query: {row.searchQuery || "—"}</div>
        <div className="break-all opacity-80">api: {row.apiQueryUrl || "—"}</div>
        <div>
          candidates_api: {row.candidateCount ?? "—"} · elapsed_ms {row.elapsedMs ?? "—"}
        </div>
        <div className="break-all">snapshots: {row.rawSnapshotPaths.join("; ") || "—"}</div>
      </div>
      <div>
        <span className="text-xs uppercase" style={{ color: "var(--cal-accent)" }}>
          Loader
        </span>
        <div className="grid gap-1 sm:grid-cols-2">
          <span>parsed_attempt_count: {pipeline.parsed_attempt_count}</span>
          <span>parsed_candidate_count: {pipeline.parsed_candidate_count}</span>
          <span>unique_candidate_keys: {pipeline.unique_candidate_billboard_keys}</span>
          <span>joined_review_rows: {pipeline.joined_review_rows}</span>
          <span>deduped_review_count: {pipeline.deduped_review_count}</span>
          <span>calibration_queue_count: {pipeline.queue_count}</span>
          <span>calibration_excluded: {pipeline.calibration_excluded_count}</span>
          <span>hard_failure_bucket: {pipeline.calibration_hard_failure_bucket_count}</span>
          <span>retrieval_dead_end_excluded: {pipeline.calibration_retrieval_dead_end_excluded_count}</span>
          <span>calibration_mode: {pipeline.calibration_queue_mode}</span>
          <span>calibration_cap: {pipeline.calibration_queue_cap}</span>
          <span>calibration_pre_cap: {pipeline.calibration_queue_pre_cap_count}</span>
          <span>calibration_state_resolved: {pipeline.calibration_state_resolved_count ?? 0}</span>
        </div>
      </div>
    </div>
  );

  const stateColor =
    calSummary?.tone === "bad"
      ? "#c97a72"
      : calSummary?.tone === "warn"
        ? "var(--cal-warn)"
        : calSummary?.tone === "good"
          ? "#7ec878"
          : "var(--cal-muted)";

  return (
    <div className="itunes-cal-scope flex min-h-[calc(100dvh-3.5rem)] max-[959px]:overflow-y-auto min-[960px]:h-[calc(100dvh-3.5rem)] min-[960px]:overflow-hidden flex-col text-[var(--cal-fg)]">
      {decisionFlash ? (
        <div
          className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center"
          role="status"
          aria-live="polite"
        >
          <div
            className="rounded-lg border-4 border-black px-14 py-8 font-mono text-[clamp(2rem,6vw,3.5rem)] font-black leading-none tracking-widest text-white shadow-2xl min-[960px]:px-20 min-[960px]:py-12"
            style={{ background: "rgba(0,0,0,0.88)", boxShadow: "0 0 0 2px rgba(255,255,255,0.2)" }}
          >
            {decisionFlash === "use_this"
              ? "USE THIS"
              : decisionFlash === "try_again"
                ? "TRY AGAIN"
                : "SKIP"}
          </div>
        </div>
      ) : null}
      <style>{`
        .itunes-cal-scope {
          --cal-bg: #1a1816;
          --cal-panel: #222019;
          --cal-elevated: #2a2622;
          --cal-border: rgba(212, 196, 176, 0.12);
          --cal-muted: #8f8578;
          --cal-fg: #e8e2dc;
          --cal-accent: #b89a78;
          --cal-warn: #c9a060;
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          background: var(--cal-bg);
        }
        .cal-strategy {
          border: 1px solid rgba(120, 140, 170, 0.35);
          background: rgba(45, 52, 62, 0.5);
          color: var(--cal-fg);
          border-radius: 4px;
          padding: 12px 18px;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
        }
        .cal-strategy:hover:enabled { background: rgba(55, 62, 74, 0.65); }
        .cal-strategy:disabled { opacity: 0.45; cursor: not-allowed; }
        .cal-strip-tile {
          border-radius: 10px;
          overflow: hidden;
          cursor: pointer;
          transition: box-shadow 0.12s ease, transform 0.12s ease;
        }
        .cal-hero-wrap {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          min-height: 68vh;
          padding: 0;
          box-sizing: border-box;
        }
        .cal-hero-img {
          max-width: 100%;
          width: auto;
          height: auto;
          min-height: 65vh;
          max-height: min(92vh, 100%);
          object-fit: contain;
          object-position: center;
          image-rendering: auto;
        }
        @media (max-width: 959px) {
          .cal-hero-wrap { min-height: 52vh; }
          .cal-hero-img { min-height: 48vh; max-height: min(85vh, 100%); }
        }
        .cal-ops-assist {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
          line-height: 1.2;
          gap: 6px;
          padding: 22px 28px;
          min-height: 5.5rem;
        }
        .cal-ops-assist-title {
          font-size: clamp(17px, 2.2vw, 22px);
          font-weight: 900;
          letter-spacing: 0.12em;
        }
        .cal-ops-btn-aux.cal-ops-assist {
          text-transform: none;
        }
        .cal-ops-btn-aux.cal-ops-assist .cal-ops-assist-title {
          text-transform: uppercase;
        }
        .cal-ops-assist-hint {
          font-size: clamp(13px, 1.5vw, 15px);
          font-weight: 600;
          letter-spacing: 0.04em;
          text-transform: none;
          opacity: 0.88;
          line-height: 1.35;
          max-width: 28rem;
        }
        .cal-strip-tile:hover { opacity: 0.92; }
        .cal-strip-tile-active {
          box-shadow: 0 0 0 3px rgba(184, 154, 120, 0.75), 0 12px 40px rgba(0,0,0,0.45);
        }
        .cal-status-overlay {
          max-width: min(calc(100% - 1rem), 44rem);
          border-width: 6px;
          border-style: solid;
          padding: 1.25rem 1.5rem;
        }
        @media (min-width: 960px) {
          .cal-status-overlay {
            max-width: min(calc(100% - 2rem), 52rem);
            padding: 1.75rem 2.5rem 2rem;
          }
        }
        .cal-status-overlay-head {
          font-family: ui-monospace, ui-sans-serif, system-ui, monospace;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          line-height: 1.05;
          font-size: clamp(1.85rem, 6.5vw, 4.25rem);
          text-shadow:
            0 3px 0 #000,
            0 0 28px rgba(0, 0, 0, 0.75),
            0 0 2px #000;
        }
        .cal-status-overlay-detail {
          margin-top: 0.85rem;
          font-size: clamp(1.2rem, 3.2vw, 2.05rem);
          font-weight: 700;
          line-height: 1.35;
          color: #f2ece4;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.85);
        }
        .cal-ops-zone {
          border-top: 3px solid var(--cal-border);
          background: #020100;
          position: relative;
          z-index: 20;
        }
        .cal-ops-strip {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 32px;
          padding: 22px 20px 28px;
        }
        .cal-ops-row-primary {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: stretch;
          gap: 20px;
          max-width: 72rem;
        }
        .cal-ops-row-secondary {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: stretch;
          gap: 14px;
          max-width: 52rem;
        }
        /* Jukebox / transport — secondary row (still large, not “toolbar”) */
        .cal-ops-btn-aux {
          border: 3px solid rgba(200, 185, 160, 0.5);
          background: linear-gradient(180deg, #454038 0%, #2a2622 45%, #141210 100%);
          color: #faf6ef;
          border-radius: 4px;
          padding: 22px 34px;
          font-size: clamp(16px, 2vw, 21px);
          font-weight: 900;
          letter-spacing: 0.14em;
          cursor: pointer;
          text-transform: uppercase;
          box-shadow:
            inset 0 2px 0 rgba(255, 255, 255, 0.1),
            inset 0 -3px 0 rgba(0, 0, 0, 0.45),
            0 6px 16px rgba(0, 0, 0, 0.55);
          min-height: 5rem;
        }
        .cal-ops-btn-aux:hover:enabled {
          background: linear-gradient(180deg, #524a42 0%, #33302c 45%, #1a1815 100%);
          border-color: rgba(255, 230, 190, 0.55);
        }
        .cal-ops-btn-aux:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }
        /* Slam row — primary decisions */
        .cal-ops-btn-prime {
          border: 5px solid rgba(255, 235, 210, 0.55);
          background: linear-gradient(180deg, #5c554c 0%, #352f28 38%, #14110e 100%);
          color: #fffef8;
          border-radius: 6px;
          padding: clamp(22px, 3vw, 32px) clamp(32px, 4.5vw, 52px);
          font-size: clamp(22px, 3.2vw, 30px);
          font-weight: 900;
          letter-spacing: 0.14em;
          cursor: pointer;
          text-transform: uppercase;
          box-shadow:
            inset 0 3px 0 rgba(255, 255, 255, 0.18),
            inset 0 -4px 0 rgba(0, 0, 0, 0.5),
            0 8px 22px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(0, 0, 0, 0.4);
          min-height: 6.5rem;
        }
        .cal-ops-btn-prime:hover:enabled {
          background: linear-gradient(180deg, #6e655a 0%, #40382f 40%, #1c1814 100%);
          border-color: rgba(255, 245, 210, 0.75);
          box-shadow:
            inset 0 3px 0 rgba(255, 255, 255, 0.22),
            inset 0 -4px 0 rgba(0, 0, 0, 0.5),
            0 10px 28px rgba(0, 0, 0, 0.65);
        }
        .cal-ops-btn-prime:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }
        .cal-ops-btn-prime.cal-ops-btn-accent {
          border-color: rgba(255, 220, 140, 0.95);
          background: linear-gradient(180deg, #d4a84a 0%, #8a6530 35%, #3d2a10 100%);
          color: #1a1206;
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.25);
        }
        .cal-ops-btn-prime.cal-ops-btn-accent:hover:enabled {
          background: linear-gradient(180deg, #e8b850 0%, #9a7238 35%, #4a3214 100%);
        }
        .cal-ops-btn-prime.cal-ops-btn-danger {
          border-color: rgba(255, 120, 100, 0.95);
          background: linear-gradient(180deg, #c44a3c 0%, #6e2820 40%, #220c0a 100%);
          color: #fff5f3;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
        }
        .cal-ops-btn-prime.cal-ops-btn-danger:hover:enabled {
          background: linear-gradient(180deg, #d85848 0%, #7e3028 40%, #2a100c 100%);
        }
        .cal-ops-btn-prime.cal-ops-btn-transport {
          border-color: rgba(180, 195, 210, 0.6);
          background: linear-gradient(180deg, #4a5058 0%, #2c3036 40%, #121418 100%);
          color: #f4f6f8;
        }
        .cal-ops-btn-prime.cal-ops-btn-transport:hover:enabled {
          background: linear-gradient(180deg, #565c64 0%, #363a42 40%, #181c20 100%);
          border-color: rgba(210, 225, 240, 0.7);
        }
        .cal-ops-kbd {
          margin-left: 10px;
          font-family: ui-monospace, monospace;
          font-size: 13px;
          font-weight: 900;
          opacity: 0.68;
          letter-spacing: 0;
        }
        .cal-ops-kbd-lg {
          margin-left: 12px;
          font-family: ui-monospace, monospace;
          font-size: clamp(14px, 2vw, 18px);
          font-weight: 900;
          opacity: 0.7;
          letter-spacing: 0;
        }
      `}</style>

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-2 py-2 min-[960px]:px-4"
          style={{ borderColor: "var(--cal-border)", background: "#12100e" }}
        >
          <div className="flex flex-wrap items-center gap-2">
            {TIER_CONTROLS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`cal-ops-btn-aux px-3 py-3 text-xs font-black uppercase min-[960px]:px-5 min-[960px]:py-4 min-[960px]:text-sm ${activeTier === id ? "ring-2 ring-[var(--cal-accent)]" : ""}`}
                onClick={() => setActiveTier(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="text-right font-mono text-xs font-black leading-snug text-[var(--cal-fg)] min-[960px]:text-base">
            <span className="text-[var(--cal-muted)]">{TIER_CONTROLS.find((t) => t.id === activeTier)?.label}</span>
            <br className="min-[960px]:hidden" />
            <span className="min-[960px]:ml-3">
              Use {throughput[activeTier].useThis} · Retry {throughput[activeTier].tryAgain} · Skip{" "}
              {throughput[activeTier].skip} · Left {Math.max(0, initialQueue.length - qi - 1)}
            </span>
          </div>
        </div>
        {!row ? (
          <div
            className="rounded-lg border p-8"
            style={{
              borderColor: "var(--cal-border)",
              background: "var(--cal-panel)",
              color: "var(--cal-fg)",
            }}
            role="status"
          >
            <div className="text-xl font-semibold uppercase tracking-wide" style={{ color: "var(--cal-accent)" }}>
              Empty {TIER_CONTROLS.find((t) => t.id === activeTier)?.label ?? "queue"}
            </div>
            <p className="mt-4 text-2xl font-bold leading-relaxed text-[var(--cal-muted)]">
              No rows in this tier — switch queue with the buttons above.
              {pipeline.calibration_tier_easy_pre_cap_count != null ? (
                <>
                  {" "}
                  Pre-cap counts: EASY {pipeline.calibration_tier_easy_pre_cap_count} · CALIBRATION{" "}
                  {pipeline.calibration_tier_calibration_pre_cap_count} · HARD {pipeline.calibration_tier_hard_pre_cap_count}.
                </>
              ) : null}{" "}
              {pipeline.deduped_review_count > 0 && (
                <>
                  Corpus: {pipeline.deduped_review_count} deduped; {pipeline.calibration_excluded_count} excluded as clean
                  matches.
                </>
              )}
            </p>
            <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-[var(--cal-muted)]">
              Run batch escalation (retrieval engine):{" "}
              <code className="rounded bg-black/30 px-1.5 py-0.5 text-[var(--cal-fg)]">
                npm run itunes:escalate-retrieval-failures
              </code>{" "}
              — then refresh. Use{" "}
              <code className="rounded bg-black/30 px-1.5 py-0.5">ITUNES_ESCALATION_DRY_RUN=1</code> to list targets only.
            </p>
            <details className="mt-6 rounded border px-4 py-3" style={{ borderColor: "var(--cal-border)" }}>
              <summary className="cursor-pointer text-sm font-medium" style={{ color: "var(--cal-accent)" }}>
                Loader diagnostics
              </summary>
              <pre className="mt-3 overflow-auto whitespace-pre-wrap font-mono text-xs text-[var(--cal-muted)]">
                {JSON.stringify(pipeline, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <>
            {/* Full-bleed status — no centered composition */}
            <div
              className="flex shrink-0 items-center gap-6 border-b px-3 py-3 font-mono text-sm font-bold uppercase tracking-wider min-[960px]:text-base"
              style={{ borderColor: "var(--cal-border)", background: "#12100e", color: "var(--cal-muted)" }}
            >
              <span className="text-2xl font-black text-[var(--cal-fg)] min-[960px]:text-3xl">
                {qi + 1} / {initialQueue.length}
              </span>
              <span>{row.calibrationQueueState ?? "NEW"}</span>
              {!isDiscogsLane ? (
                <span>
                  · retrieve {Math.min(escStage, ESCALATION_TOTAL)}/{ESCALATION_TOTAL}
                </span>
              ) : (
                <span className="text-[var(--cal-warn)]">· DISCOGS LANE</span>
              )}
              <span className="ml-auto hidden text-sm font-semibold normal-case tracking-normal min-[1100px]:inline">
                1 use · 2 retry · 3 skip · ← →
              </span>
            </div>

            <div
              className="grid min-h-0 flex-1 grid-cols-1 gap-0 min-[960px]:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]"
              style={{ borderColor: "var(--cal-border)" }}
            >
              {/* LEFT WORK AREA (~70%): browser strip | hero; ops directly under */}
              <div
                className="flex min-h-[45vh] flex-col border-b min-[960px]:min-h-0 min-[960px]:border-b-0 min-[960px]:border-r"
                style={{ borderColor: "var(--cal-border)", background: "#0a0908" }}
              >
                <div className="flex min-h-0 min-[960px]:min-h-0 flex-[1_1_auto] flex-row gap-0 min-[960px]:min-h-[70vh] min-[960px]:flex-[1_1_80%] min-[960px]:gap-px">
                  <div
                    className="flex w-[min(26vw,17rem)] shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden border-r px-1.5 py-2 min-[960px]:w-[min(22vw,18rem)] min-[960px]:gap-2.5 min-[960px]:px-2"
                    style={{ borderColor: "var(--cal-border)", background: "#060504" }}
                  >
                    {stripFocusIndices.map((fi) => {
                      const isPipeline = fi === -1;
                      const cand = !isPipeline ? candidatePool[fi]! : null;
                      const pv = !isPipeline ? previews[fi] : null;
                      const thumbUrl = isPipeline
                        ? thumbStrip(row.artworkUrl)
                        : thumbStrip(pv?.artworkUrl ?? null);
                      const active = focus === fi;
                      const label = isPipeline ? "PRIMARY" : `ALT ${fi + 1}`;
                      const albumTitle = isPipeline
                        ? row.matchedAlbum.trim() || row.billboardAlbum
                        : (cand?.candidateAlbum ?? "—").trim() || "—";
                      const yearShow = isPipeline ? row.matchedReleaseYear : pv?.releaseYear ?? null;
                      const scoreShow = isPipeline ? row.finalScore : cand?.finalScore ?? null;
                      return (
                        <button
                          key={fi === -1 ? "pipeline" : `cand-${fi}`}
                          type="button"
                          onClick={() => setFocus(fi)}
                          className={`cal-strip-tile w-full shrink-0 text-left ring-2 ring-transparent ${active ? "cal-strip-tile-active ring-[var(--cal-accent)]" : "ring-[rgba(212,196,176,0.15)]"}`}
                          title="Promote to hero"
                        >
                          <div
                            className="aspect-square w-full min-h-[11rem] overflow-hidden bg-neutral-950 min-[960px]:min-h-[14rem]"
                            style={{ border: active ? "none" : "1px solid var(--cal-border)" }}
                          >
                            {thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-lg font-black text-[var(--cal-muted)]">
                                —
                              </div>
                            )}
                          </div>
                          <div className="mt-2.5 px-0.5">
                            <div className="font-mono text-xs font-black uppercase tracking-widest text-[var(--cal-accent)] min-[960px]:text-sm">
                              {label}
                            </div>
                            <div className="mt-1 line-clamp-2 text-base font-bold leading-tight text-[var(--cal-fg)] min-[960px]:text-lg">
                              {albumTitle}
                            </div>
                            <div className="mt-0.5 font-mono text-base font-black text-[#e0c48a] min-[960px]:text-lg">
                              {yearShow ?? "—"} · {fmtScore(scoreShow)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Hero — dominates viewport; overflow hidden so art cannot paint over ops buttons */}
                  <div
                    className="relative z-0 min-h-0 min-w-0 flex-1 overflow-hidden min-[960px]:min-h-[72vh]"
                    style={{ background: "radial-gradient(ellipse 90% 85% at 50% 45%, #1c1a16 0%, #050403 100%)" }}
                  >
                    {showWorkflowOverlay && calSummary ? (
                      <div
                        className="cal-status-overlay pointer-events-none absolute right-2 top-2 z-10 max-w-[min(52rem,96%)] min-[960px]:right-4 min-[960px]:top-4"
                        style={{
                          borderColor: stateColor,
                          background: "linear-gradient(165deg, rgba(12,10,8,0.97) 0%, rgba(4,3,2,0.98) 100%)",
                          boxShadow: `0 0 0 2px #000, 0 0 0 8px ${stateColor}33, 0 20px 50px rgba(0,0,0,0.75)`,
                        }}
                        role="status"
                        aria-live="polite"
                      >
                        <p className="cal-status-overlay-head" style={{ color: stateColor }}>
                          {calSummary.headline}
                        </p>
                        {calSummary.lines.map((ln, i) => (
                          <p key={i} className="cal-status-overlay-detail">
                            {ln}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <div className="absolute inset-0 flex items-center justify-center p-0">
                      <div className="cal-hero-wrap">
                        {centerArt ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={centerArt} alt="" className="cal-hero-img" />
                        ) : (
                          <div className="px-4 text-center text-3xl font-black text-[var(--cal-muted)] min-[960px]:text-5xl">
                            NO ARTWORK — TRY AGAIN OR SKIP
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="cal-ops-zone flex min-h-0 flex-[1_1_auto] shrink-0 flex-col justify-center min-[960px]:flex-[1_1_28%] min-[960px]:min-h-[18rem]">
                  <div className="cal-ops-strip">
                    <div className="cal-ops-row-primary">
                      <button
                        type="button"
                        className="cal-ops-btn-prime cal-ops-btn-accent"
                        disabled={postingDecision || decisionFlash !== null}
                        onClick={() => void postCalibrationAction("use_this")}
                      >
                        USE THIS<span className="cal-ops-kbd-lg">1</span>
                      </button>
                      <button
                        type="button"
                        className="cal-ops-btn-prime cal-ops-btn-danger"
                        disabled={
                          postingDecision || decisionFlash !== null || isDiscogsLane
                        }
                        onClick={() => void postCalibrationAction("try_again")}
                      >
                        TRY AGAIN<span className="cal-ops-kbd-lg">2</span>
                      </button>
                      <button
                        type="button"
                        className="cal-ops-btn-prime cal-ops-btn-transport"
                        disabled={postingDecision || decisionFlash !== null}
                        onClick={() => void postCalibrationAction("skip")}
                      >
                        SKIP<span className="cal-ops-kbd-lg">3</span>
                      </button>
                      <button
                        type="button"
                        className="cal-ops-btn-prime cal-ops-btn-transport"
                        disabled={postingDecision || decisionFlash !== null}
                        onClick={goPrev}
                      >
                        PREVIOUS<span className="cal-ops-kbd-lg">←</span>
                      </button>
                      <button
                        type="button"
                        className="cal-ops-btn-prime cal-ops-btn-transport"
                        disabled={postingDecision || decisionFlash !== null}
                        onClick={goNext}
                      >
                        NEXT<span className="cal-ops-kbd-lg">→</span>
                      </button>
                    </div>
                    {isDiscogsLane ? (
                      <div className="cal-ops-row-secondary flex-col items-stretch">
                        <p className="max-w-[52rem] px-2 text-center font-mono text-sm font-bold text-[var(--cal-warn)]">
                          Manual recovery — paste a Discogs release URL below.
                        </p>
                        <div className="flex w-full max-w-[52rem] flex-col gap-3 px-2 sm:flex-row sm:items-stretch">
                          <button type="button" className="cal-ops-btn-aux" onClick={openDiscogs}>
                            OPEN DISCOGS
                          </button>
                        </div>
                        <div
                          className="flex w-full max-w-[52rem] flex-col gap-3 px-2 sm:flex-row sm:items-stretch"
                          style={{ borderColor: "var(--cal-border)" }}
                        >
                          <input
                            type="url"
                            placeholder="Paste Discogs release URL…"
                            className="min-h-[3.25rem] flex-1 rounded border px-4 font-mono text-base font-semibold outline-none min-[960px]:text-lg"
                            style={{
                              borderColor: "var(--cal-border)",
                              background: "var(--cal-bg)",
                              color: "var(--cal-fg)",
                            }}
                            value={discogsPaste}
                            onChange={(e) => setDiscogsPaste(e.target.value)}
                          />
                          <button
                            type="button"
                            className="cal-ops-btn-aux shrink-0 px-8"
                            disabled={busy === "discogs" || !discogsPaste.trim()}
                            onClick={() => void saveDiscogsRecovery()}
                          >
                            SAVE RECOVERY
                          </button>
                        </div>
                        {discogsMsg ? (
                          <p className="max-w-[52rem] px-2 text-center font-mono text-sm font-bold text-[var(--cal-warn)] min-[960px]:text-base">
                            {discogsMsg}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                {rerunLog ? (
                  <pre
                    className="max-h-24 shrink-0 overflow-auto border-t px-2 py-1 font-mono text-[10px] leading-snug"
                    style={{ borderColor: "var(--cal-border)", background: "#000", color: "var(--cal-muted)" }}
                  >
                    {rerunLog}
                  </pre>
                ) : null}
              </div>

              {/* RIGHT METADATA WALL — full height, flush */}
              <div
                className="flex min-h-[38vh] flex-col overflow-hidden min-[960px]:min-h-0"
                style={{ background: "var(--cal-panel)" }}
              >
                <div
                  className="grid min-h-0 flex-1 grid-cols-1 grid-rows-1 min-[640px]:grid-cols-2"
                  style={{ borderColor: "var(--cal-border)" }}
                >
                  <div
                    className="flex min-h-0 flex-col gap-4 overflow-y-auto border-b p-4 min-[640px]:border-b-0 min-[640px]:border-r min-[960px]:gap-6 min-[960px]:p-6"
                    style={{ borderColor: "var(--cal-border)" }}
                  >
                    <div className="text-[clamp(1.35rem,2.8vw,2.65rem)] font-black uppercase leading-none tracking-tight text-[var(--cal-accent)]">
                      Billboard
                    </div>
                    <div className="text-[clamp(1.85rem,6.5vw,5.5rem)] font-black leading-[0.96] tracking-tight text-[var(--cal-fg)]">
                      {row.billboardArtist}
                    </div>
                    <div className="text-[clamp(1.65rem,5.5vw,4.6rem)] font-black leading-[1.02] text-[var(--cal-fg)]">{row.billboardAlbum}</div>
                    <div className="font-mono text-[clamp(1.85rem,6vw,5.25rem)] font-black text-[#ffd180]">{row.chartYear}</div>
                    <div className="min-h-0">
                      <div className="text-[clamp(1.15rem,2.2vw,1.85rem)] font-black uppercase tracking-wide text-[var(--cal-accent)]">Query</div>
                      <div className="mt-2 break-words text-[clamp(1.2rem,2.8vw,2.2rem)] font-bold leading-snug text-[var(--cal-fg)]">
                        {row.searchQuery?.trim() || "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 min-[960px]:gap-6 min-[960px]:p-6">
                    <div className="text-[clamp(1.35rem,2.8vw,2.65rem)] font-black uppercase leading-none tracking-tight text-[var(--cal-accent)]">
                      Retrieval
                    </div>
                    <div className="text-[clamp(1.85rem,6.5vw,5.5rem)] font-black leading-[0.96] tracking-tight text-[var(--cal-fg)]">
                      {(focusedCandidate?.candidateArtist ?? row.matchedArtist) || "—"}
                    </div>
                    <div className="text-[clamp(1.65rem,5.5vw,4.6rem)] font-black leading-[1.02] text-[var(--cal-fg)]">
                      {(focusedCandidate?.candidateAlbum ?? row.matchedAlbum) || "—"}
                    </div>
                    <div
                      className="flex flex-wrap gap-x-8 gap-y-2 font-mono text-[clamp(1.35rem,3.5vw,2.85rem)] font-black text-[#ffd180]"
                    >
                      <span>YEAR {rightReleaseYear ?? "—"}</span>
                      <span>SCORE {fmtScore(matchScoreDisplay ?? null)}</span>
                    </div>
                    {trackOverlapHint ? (
                      <div className="max-w-[100%] space-y-2 border-t border-[var(--cal-border)] pt-3">
                        <div className="font-mono text-[clamp(0.95rem,2.4vw,1.2rem)] font-black uppercase tracking-widest text-[var(--cal-muted)]">
                          {trackOverlapHint.headline}
                        </div>
                        {trackOverlapHint.contains.length ? (
                          <div className="text-[clamp(0.95rem,2.3vw,1.15rem)] font-semibold leading-snug text-[var(--cal-fg)]">
                            <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--cal-accent)]">
                              Contains ·{" "}
                            </span>
                            {trackOverlapHint.contains.join(" · ")}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div
                  className="shrink-0 border-t"
                  style={{ borderColor: "var(--cal-border)", background: "#181410" }}
                >
                  <details>
                    <summary className="cursor-pointer px-4 py-3 font-mono text-sm font-bold uppercase tracking-widest text-[var(--cal-muted)] hover:text-[var(--cal-fg)]">
                      Technical debug
                    </summary>
                    <div className="max-h-64 overflow-auto border-t px-4 py-3" style={{ borderColor: "var(--cal-border)" }}>
                      {debugDetails}
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
