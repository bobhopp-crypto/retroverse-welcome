"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { normalizeCandidateArtworkUrl } from "@/lib/artwork-candidate-fingerprint";
import { validateAlbumRowForCurator } from "@/lib/curator-album-metadata";
import {
  CURATOR_CLIENT_INGRESS_DEBOUNCE_MS,
  fetchPortalCuratorWorkbenchSession,
  type PortalCuratorWorkbenchResult,
} from "@/lib/portal-curator-workbench-client";

const CURATOR_METADATA_ISSUES: Record<string, string> = {
  row_not_album: "Internal error: not an album row.",
  missing_album_id: "Missing Retroverse album id.",
  missing_title: "Album title blank in Retroverse.",
  missing_artist: "Artist blank in Retroverse.",
  unresolved_artist: 'Artist FK did not resolve (shows as "Unknown artist").',
};

type WorkbenchCandidate = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url?: string | null;
  stagedFilePath?: string | null;
};



type CandidateApiFailureDetail = Extract<PortalCuratorWorkbenchResult, { ok: false }>["error"];

function HeroCover({ src, fallbackLabel, remixKey }: { src: string | null; fallbackLabel: string; remixKey: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={remixKey}
        src={src}
        alt=""
        /**
         * iOS Safari shows a "Share / Save to Photos / Copy / Look Up" sheet on
         * long-press unless we explicitly disable the touch callout, suppress
         * selection, and swallow the context menu. The hero cover is decorative
         * here, so we strip the affordance entirely.
         */
        className="h-full w-full object-cover object-center select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
        draggable={false}
        loading="eager"
        decoding="sync"
        onDragStart={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
    );
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_42%_36%,rgba(200,169,107,0.12),transparent_56%),linear-gradient(168deg,#08111d,#05070b)] px-3 text-center"
      role="img"
      aria-label={fallbackLabel}
    >
      <span className="text-[clamp(1rem,3.6vw,1.2rem)] leading-snug text-[#b7aa95]">{fallbackLabel}</span>
    </div>
  );
}

function CandidateTile({
  candidate,
  active,
  hasSelection,
  onPick,
}: {
  candidate: WorkbenchCandidate;
  active: boolean;
  hasSelection: boolean;
  onPick: () => void;
}) {
  const primary = normalizeCandidateArtworkUrl(candidate.image);
  const [showImg, setShowImg] = useState(true);

  const dimPeer = hasSelection && !active;

  return (
    <button
      type="button"
      onClick={onPick}
      style={{ pointerEvents: "auto", touchAction: "manipulation" }}
      className={[
        "relative block w-full overflow-hidden rounded-xl transition-[transform,opacity] duration-200 ease-out",
        "active:scale-[0.98]",
        dimPeer ? "opacity-45" : "opacity-100",
        active
          ? "ring-2 ring-[#c8a96b] ring-offset-2 ring-offset-[#05070b]"
          : "ring-1 ring-[rgba(200,169,107,0.28)] hover:ring-[#c8a96b]/55",
      ].join(" ")}
      aria-pressed={active}
    >
      <span className="pointer-events-none block aspect-square w-full bg-[#08111d]">
        {primary && showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primary}
            alt=""
            /** Same iOS long-press suppression as HeroCover above. */
            className="pointer-events-none h-full w-full object-cover object-center select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
            draggable={false}
            loading="eager"
            decoding="async"
            onDragStart={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            onError={() => setShowImg(false)}
          />
        ) : (
          <span className="block h-full w-full bg-[#08111d]" aria-hidden />
        )}
      </span>
    </button>
  );
}

function RestorationPanel({
  label,
  eyebrow,
  src,
  fallbackLabel,
  remixKey,
  active = false,
  restored = false,
}: {
  label: string;
  eyebrow: string;
  src: string | null;
  fallbackLabel: string;
  remixKey: string;
  active?: boolean;
  restored?: boolean;
}) {
  return (
    <section
      className={[
        "min-w-0 rounded-[1.05rem] p-[3px] transition-all duration-500",
        restored
          ? "bg-[linear-gradient(145deg,rgba(255,123,64,0.95),rgba(200,169,107,0.9)_42%,rgba(109,59,255,0.76))] shadow-[0_0_34px_rgba(255,123,64,0.28)]"
          : active
            ? "bg-[linear-gradient(145deg,rgba(200,169,107,0.72),rgba(113,78,43,0.35),rgba(18,34,52,0.92))]"
            : "bg-[linear-gradient(145deg,rgba(200,169,107,0.28),rgba(14,25,38,0.88))]",
      ].join(" ")}
    >
      <div className="rounded-[0.9rem] bg-[radial-gradient(circle_at_30%_0%,rgba(255,123,64,0.14),transparent_42%),linear-gradient(180deg,#100b16,#07111c)] p-2 shadow-[inset_0_0_0_1px_rgba(243,234,219,0.08)]">
        <div className="mb-2 flex min-h-10 flex-col justify-end">
          <p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-[#c8a96b]">{eyebrow}</p>
          <p className="mt-0.5 truncate text-[13px] font-semibold text-[#f3eadb]">{label}</p>
        </div>
        <div
          className={[
            "relative aspect-square overflow-hidden rounded-[0.7rem] bg-[#08111d] ring-1 transition-transform duration-500",
            restored ? "scale-[1.015] ring-[#f3eadb]/45" : "ring-[rgba(200,169,107,0.22)]",
          ].join(" ")}
          style={{
            boxShadow: restored
              ? "0 18px 44px rgba(0,0,0,0.58), inset 0 0 38px rgba(255,255,255,0.08)"
              : "inset 0 0 38px rgba(0,0,0,0.55)",
          }}
        >
          <HeroCover src={src} fallbackLabel={fallbackLabel} remixKey={remixKey} />
        </div>
      </div>
    </section>
  );
}

type PortalV2CuratePresentation = "page" | "overlay";

/**
 * Payload handed back to the parent (Portal) when a save succeeds so the parent
 * can patch its in-memory row cache and cache-bust the hero image without a
 * full reload.
 */
export type PortalV2CuratorSavedDetail = {
  albumId: string;
  canonicalCoverPath: string | null;
  savedAt: number;
  publicCoverUrl?: string | null;
};

export default function PortalV2CurateClient({
  row,
  presentation = "page",
  coverBaseUrl = null,
  onDismiss,
  onSaved,
}: {
  row: DiscoverStableAlbumRow;
  presentation?: PortalV2CuratePresentation;
  coverBaseUrl?: string | null;
  onDismiss?: () => void;
  onSaved?: (detail: PortalV2CuratorSavedDetail) => void;
}) {
  const router = useRouter();
  const isOverlay = presentation === "overlay";
  const [candidates, setCandidates] = useState<WorkbenchCandidate[]>([]);
  const [ingestWarnings, setIngestWarnings] = useState<string[]>([]);
  const [candidateFetchError, setCandidateFetchError] = useState<CandidateApiFailureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * URL-based selection — survives grid re-ordering, scroll, and unrelated
   * re-renders. Compared against `normalizeCandidateArtworkUrl(candidate.image)`.
   */
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");

  /**
   * Manual "paste a Discogs URL" path — used when the 3 auto-candidates aren't
   * right and the user wants to point at a specific release on Discogs.
   * Accepts either a direct image URL (i.discogs.com/...) or a release/master
   * page URL (resolved server-side via /resolve-discogs-url).
   */
  const [pasteUrl, setPasteUrl] = useState("");
  const [pastePending, setPastePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /**
   * Set after a successful save in page mode so the hero re-fetches the new
   * canonical bytes (R2 key stays the same; only the bytes changed). In overlay
   * mode the parent handles cache-busting via `coverBustByAlbumId`, so this
   * stays null.
   */
  const [savedCacheBust, setSavedCacheBust] = useState<number | null>(null);
  const [savedDisplayUrl, setSavedDisplayUrl] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);

  /**
   * `normalizeCandidateArtworkUrl` strips query params (used for dedupe), so
   * the cache-bust token has to be applied AFTER normalization — otherwise it
   * would be stripped and the browser would keep showing the stale image.
   */
  const archiveCoverUrl = useMemo(() => {
    const normalized = normalizeCandidateArtworkUrl(
      canonicalCoverPathToUrl(row.canonicalCoverPath, {
        cacheBust: row.canonicalCoverCacheBust ?? undefined,
        coverBaseUrl,
      }),
    );
    return normalized;
  }, [row.canonicalCoverPath, row.canonicalCoverCacheBust, coverBaseUrl]);

  const grid = useMemo(() => {
    const out: WorkbenchCandidate[] = [];
    for (const c of candidates) {
      if (c.source !== "discogs") continue;
      const u = normalizeCandidateArtworkUrl(c.image);
      if (!u) continue;
      out.push({ ...c, image: u });
    }
    return out;
  }, [candidates]);

  const discogsSearchHref = useMemo(() => {
    const q = `${row.artist} ${row.title}`.replace(/\s+/g, " ").trim();
    return `https://www.discogs.com/search/?q=${encodeURIComponent(q)}`;
  }, [row.artist, row.title]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- gated debounced ingest on album identity primitives */
    const meta = validateAlbumRowForCurator(row);
    if (!meta.ok) {
      setLoading(false);
      setCandidates([]);
      setIngestWarnings(meta.issues.map((code) => CURATOR_METADATA_ISSUES[code] ?? code));
      setCandidateFetchError(null);
      setSelectedUrl(null);
      return;
    }

    setLoading(true);
    setCandidateFetchError(null);

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void (async () => {
        try {
          const packed = await fetchPortalCuratorWorkbenchSession({
            artist: row.artist,
            title: row.title,
            albumId: row.albumId,
            year: row.year,
          });
          if (cancelled) return;
          if (!packed.ok) {
            setCandidates([]);
            setIngestWarnings([]);
            setCandidateFetchError(packed.error);
            setSelectedUrl(null);
            return;
          }
          if (packed.discogsUnavailable) {
            setCandidates([]);
            setIngestWarnings([]);
            setCandidateFetchError({
              kind: "http",
              endpoint: "/api/artwork-workbench/candidates",
              requestUrl: packed.requestUrl,
              httpStatus: null,
              detail: "discogs_unreachable",
            });
            setSelectedUrl(null);
            return;
          }
          setCandidateFetchError(null);
          setCandidates(packed.candidates.filter((c) => c.source === "discogs"));
          setIngestWarnings(packed.warnings);
          setSelectedUrl(null);
        } catch (e) {
          if (!cancelled) {
            setCandidates([]);
            setIngestWarnings([]);
            setCandidateFetchError({
              kind: "network",
              endpoint: "/api/artwork-workbench/candidates",
              requestUrl: "",
              httpStatus: null,
              detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
            });
            console.error("[PortalV2CurateClient] candidates_load_unhandled", e);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, CURATOR_CLIENT_INGRESS_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Ingest keyed on stable album primitives; avoids parent row object identity churn re-fetching curator.
  }, [row.albumId, row.artist, row.title, row.year]);

  const displaySlots: WorkbenchCandidate[] = useMemo(
    () => (loading || candidateFetchError ? [] : grid),
    [candidateFetchError, grid, loading],
  );

  const selected = useMemo(() => {
    if (!selectedUrl) return null;
    return displaySlots.find((c) => normalizeCandidateArtworkUrl(c.image) === selectedUrl) ?? null;
  }, [selectedUrl, displaySlots]);

  const previewSrc = selected ? normalizeCandidateArtworkUrl(selected.image) : null;
  const restoredCoverUrl = previewSrc ?? savedDisplayUrl;
  const archiveRemixKey = `current-${normalizeCandidateArtworkUrl(archiveCoverUrl) ?? "none"}`;
  const restoredRemixKey = selected
    ? `restored-pick-${normalizeCandidateArtworkUrl(selected.image) ?? "none"}`
    : `restored-${normalizeCandidateArtworkUrl(savedDisplayUrl) ?? "empty"}-${savedCacheBust ?? 0}`;

  const hasSelection = Boolean(selected);

  function formatSaveFailure(
    httpStatus: number,
    payload: {
      error?: string;
      message?: string;
      stage?: string;
      detail?: string;
      traceId?: string;
    } | null,
    rawBody: string,
  ): string {
    const err = payload?.message ?? payload?.error ?? "";
    const stage = payload?.stage ? ` [${payload.stage}]` : "";
    const detail = payload?.detail && payload.detail !== err ? ` — ${payload.detail}` : "";
    const trace = payload?.traceId ? ` (trace ${payload.traceId})` : "";
    if (httpStatus === 401 && err === "ops_gate_required") {
      return `Restoration blocked: ops PIN required${trace}. Open /internal/ops-pin then retry.`;
    }
    if (err) return `Restoration failed${stage}: ${err}${detail}${trace}`;
    if (rawBody.trim()) {
      return `Restoration failed (HTTP ${httpStatus}): ${rawBody.slice(0, 240)}${rawBody.length > 240 ? "…" : ""}${trace}`;
    }
    return `Restoration failed (HTTP ${httpStatus})${trace}`;
  }

  useEffect(() => {
    if (loading || candidateFetchError) return;
    for (const c of grid) {
      const u = normalizeCandidateArtworkUrl(c.image);
      if (u) {
        const img = new Image();
        img.src = u;
      }
    }
  }, [loading, candidateFetchError, grid]);

  async function applySelected() {
    if (!selected || applyPending || pastePending) return;
    const stagedAbs =
      typeof selected.stagedFilePath === "string" ? selected.stagedFilePath.trim() : "";
    const img = typeof selected.image === "string" ? selected.image.trim() : "";

    let remoteHttps: string | null = null;
    if (/^https:\/\//i.test(img)) {
      remoteHttps = img;
    } else if (typeof selected.url === "string" && /^https:\/\//i.test(selected.url)) {
      remoteHttps = selected.url;
    }

    const hasStaged = stagedAbs.length > 0;
    const hasRemote = remoteHttps !== null && selected.source === "discogs";

    if (!hasStaged && !hasRemote) return;

    const replaceSource: "discogs" | "staged" = hasStaged ? "staged" : "discogs";
    const requestUrl = "/api/artwork-workbench/living-action";
    const requestBody = {
      action: "replace_artwork" as const,
      albumId: row.albumId,
      artist: row.artist,
      title: row.title,
      confidence: null,
      candidateSource: selected.image ?? remoteHttps,
      candidateImageUrl: hasRemote ? remoteHttps : null,
      stagedFilePath: hasStaged ? stagedAbs : null,
      sourceArtist: selected.artist,
      sourceCollection: selected.title,
      sourceReleaseDate: selected.year ? `${selected.year}-01-01` : null,
      replaceSource,
    };

    setApplyPending(true);
    setSaveError(null);
    setSaveSuccess(null);
    setRestoredAt(null);
    console.log("[CURATOR/CLIENT] save_started", {
      albumId: row.albumId,
      replaceSource,
      hasStaged,
      hasRemote,
      candidateImagePreview: remoteHttps?.slice(0, 120) ?? selected.image?.slice(0, 120) ?? null,
      requestUrl,
    });
    try {
      const res = await fetch(requestUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const rawBody = await res.text();
      let payload: {
        ok?: boolean;
        error?: string;
        message?: string;
        stage?: string;
        detail?: string;
        traceId?: string;
        canonicalPath?: string | null;
        canonicalCoverPath?: string | null;
        displayUrl?: string | null;
        publicCoverUrl?: string | null;
        savedAt?: number;
        storage?: string;
        localDbVerified?: boolean;
      } = {};
      try {
        payload = JSON.parse(rawBody || "{}") as typeof payload;
      } catch (parseErr) {
        console.error("[CURATOR/CLIENT] save_response_json_parse_failed", {
          albumId: row.albumId,
          httpStatus: res.status,
          bodyPreview: rawBody.slice(0, 500),
          parseErr,
        });
        setSaveError(formatSaveFailure(res.status, null, rawBody));
        return;
      }

      console.log("[CURATOR/CLIENT] save_response", {
        albumId: row.albumId,
        httpStatus: res.status,
        ok: payload.ok ?? null,
        error: payload.error ?? null,
        traceId: payload.traceId ?? null,
        canonicalPath: payload.canonicalPath ?? null,
        publicCoverUrl: payload.publicCoverUrl ?? null,
        bodyPreview: rawBody.slice(0, 500),
      });

      if (!res.ok || !payload.ok) {
        setSaveError(formatSaveFailure(res.status, payload, rawBody));
        return;
      }

      const savedAt = typeof payload.savedAt === "number" ? payload.savedAt : Date.now();
      const displayUrl =
        payload.displayUrl ?? payload.publicCoverUrl ?? null;
      const canonicalCoverPath =
        payload.canonicalCoverPath ?? payload.canonicalPath ?? null;

      if (displayUrl) {
        setSavedDisplayUrl(displayUrl);
      }
      setSavedCacheBust(savedAt);
      setRestoredAt(savedAt);
      setSaveSuccess(
        payload.storage === "local"
          ? "Restored identity held in the local archive."
          : "Restored identity applied to the archive.",
      );

      onSaved?.({
        albumId: row.albumId,
        canonicalCoverPath,
        savedAt,
        publicCoverUrl: displayUrl,
      });

      if (onDismiss) {
        onDismiss();
      } else {
        setSelectedUrl(null);
      }
    } catch (e) {
      const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/CLIENT] save_failed", { albumId: row.albumId, error: detail });
      setSaveError(`Restoration failed: ${detail}`);
    } finally {
      setApplyPending(false);
    }
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchDraft.trim();
    if (!q) return;
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  /**
   * Unified SAVE dispatcher. The same button serves the URL-paste flow and the
   * tile-selection flow — non-empty pasted URL wins, otherwise the selected
   * tile is saved. Caller handlers each call `e.preventDefault()` internally,
   * which is idempotent here.
   */
  function submitSave(e: FormEvent) {
    e.preventDefault();
    if (pastePending || applyPending) return;
    if (pasteUrl.trim().length > 0) {
      void submitPasteUrl(e);
      return;
    }
    if (selected) {
      void applySelected();
    }
  }

  /**
   * Classify the pasted URL without contacting Discogs:
   *   - `https://i.discogs.com/...` → already an image URL, save directly.
   *   - `https://(www\.)?discogs\.com/(release|master)/<id>...` → page URL,
   *     resolve to primary image via /api/artwork-workbench/resolve-discogs-url.
   *   - anything else → reject inline, no network call.
   */
  function classifyDiscogsPasteUrl(raw: string): "image" | "page" | "invalid" {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return "invalid";
    }
    if (u.hostname.toLowerCase() === "i.discogs.com") return "image";
    if (/^(www\.)?discogs\.com$/i.test(u.hostname) && /^\/(release|master)\/\d+/i.test(u.pathname)) {
      return "page";
    }
    return "invalid";
  }

  async function submitPasteUrl(e: FormEvent) {
    e.preventDefault();
    if (pastePending || applyPending) return;
    const raw = pasteUrl.trim();
    if (!raw) return;

    setSaveError(null);

    const kind = classifyDiscogsPasteUrl(raw);
    if (kind === "invalid") {
      setSaveError("Paste an i.discogs.com image URL or a discogs.com release/master page URL.");
      return;
    }

    setPastePending(true);
    setSaveError(null);
    setSaveSuccess(null);
    setRestoredAt(null);
    console.log("[CURATOR/CLIENT] paste_save_started", { albumId: row.albumId, urlKind: kind });
    try {
      let imageUrl: string | null = null;
      let sourceArtist = row.artist;
      let sourceTitle = row.title;
      let sourceYear: number | null = row.year ?? null;

      if (kind === "image") {
        imageUrl = raw;
      } else {
        const res = await fetch("/api/artwork-workbench/resolve-discogs-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: raw }),
        });
        if (!res.ok) {
          setSaveError(`Couldn't read that Discogs page (HTTP ${res.status}).`);
          return;
        }
        const payload = (await res.json()) as {
          ok?: boolean;
          imageUrl?: string | null;
          title?: string | null;
          artist?: string | null;
          year?: number | null;
          error?: string;
        };
        if (!payload.ok || !payload.imageUrl) {
          setSaveError(payload.error ?? "Couldn't find a cover image on that Discogs page.");
          return;
        }
        imageUrl = payload.imageUrl;
        if (payload.artist) sourceArtist = payload.artist;
        if (payload.title) sourceTitle = payload.title;
        if (typeof payload.year === "number") sourceYear = payload.year;
      }

      const saveUrl = "/api/artwork-workbench/living-action";
      const saveRes = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace_artwork",
          albumId: row.albumId,
          artist: row.artist,
          title: row.title,
          confidence: null,
          candidateSource: imageUrl,
          candidateImageUrl: imageUrl,
          stagedFilePath: null,
          sourceArtist,
          sourceCollection: sourceTitle,
          sourceReleaseDate: sourceYear ? `${sourceYear}-01-01` : null,
          replaceSource: "discogs",
        }),
      });
      const saveRaw = await saveRes.text();
      let savePayload: {
        ok?: boolean;
        error?: string;
        message?: string;
        stage?: string;
        detail?: string;
        traceId?: string;
        canonicalPath?: string | null;
        canonicalCoverPath?: string | null;
        displayUrl?: string | null;
        publicCoverUrl?: string | null;
        savedAt?: number;
        storage?: string;
      } = {};
      try {
        savePayload = JSON.parse(saveRaw || "{}") as typeof savePayload;
      } catch {
        setSaveError(formatSaveFailure(saveRes.status, null, saveRaw));
        return;
      }
      console.log("[CURATOR/CLIENT] paste_save_response", {
        albumId: row.albumId,
        httpStatus: saveRes.status,
        ok: savePayload.ok ?? null,
        error: savePayload.error ?? null,
        traceId: savePayload.traceId ?? null,
        bodyPreview: saveRaw.slice(0, 500),
      });
      if (!saveRes.ok || !savePayload.ok) {
        setSaveError(formatSaveFailure(saveRes.status, savePayload, saveRaw));
        return;
      }

      const savedAt = typeof savePayload.savedAt === "number" ? savePayload.savedAt : Date.now();
      const displayUrl =
        savePayload.displayUrl ?? savePayload.publicCoverUrl ?? null;
      const canonicalCoverPath =
        savePayload.canonicalCoverPath ?? savePayload.canonicalPath ?? null;
      if (displayUrl) setSavedDisplayUrl(displayUrl);
      setSavedCacheBust(savedAt);
      setRestoredAt(savedAt);
      setSaveSuccess("Restored identity applied to the archive.");
      onSaved?.({
        albumId: row.albumId,
        canonicalCoverPath,
        savedAt,
        publicCoverUrl: displayUrl,
      });
      if (onDismiss) {
        onDismiss();
      } else {
        setPasteUrl("");
        setSelectedUrl(null);
      }
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[CURATOR/CLIENT] paste_save_failed", { albumId: row.albumId, error: detail });
      setSaveError(`Unexpected error: ${detail}`);
    } finally {
      setPastePending(false);
    }
  }

  /**
   * Both presentations live inside `PortalAtmosphere` which locks the root to
   * `h-[100dvh]; overflow-hidden`. The curator content (cover, candidates, paste-URL
   * row, "Search the archive") exceeds the viewport, so the shell itself must
   * scroll — otherwise the bottom rows get clipped by the locked parent.
   */
  const shellCls = isOverlay
    ? "flex min-h-0 flex-1 touch-pan-y flex-col overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-8"
    : "flex min-h-0 flex-1 touch-pan-y flex-col overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pb-8";

  function dismiss() {
    onDismiss?.();
  }

  /**
   * Page-mode return path. Prefer browser history; only fall back to /portal-v2 if we have no
   * history (direct URL / bookmark).
   */
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/portal-v2");
    }
  }

  return (
    <div
      className={shellCls}
      style={{
        fontFamily: "var(--font-pv2-sans), system-ui, sans-serif",
        background:
          "radial-gradient(circle at 18% 0%, rgba(255,123,64,0.16), transparent 34%), radial-gradient(circle at 82% 12%, rgba(109,59,255,0.14), transparent 30%)",
      }}
    >
      <div className="mx-auto flex w-full max-w-md shrink-0 items-center justify-between gap-3 border-b border-[rgba(255,191,112,0.28)] pb-3">
        {isOverlay ? (
          <button
            type="button"
            onClick={dismiss}
            className="min-h-11 min-w-11 touch-manipulation rounded-md py-2 text-[1.25rem] leading-none text-[#f3eadb] active:opacity-80"
            aria-label="Close curator"
          >
            ←
          </button>
        ) : (
          <button
            type="button"
            onClick={goBack}
            className="min-h-11 min-w-11 touch-manipulation rounded-md py-2 text-[1.25rem] leading-none text-[#f3eadb] active:opacity-80"
            aria-label="Back"
          >
            ←
          </button>
        )}
        <span className="text-center text-[11px] font-semibold uppercase tracking-[0.26em] text-[#ffbf70]">
          Restoration Bench
        </span>
        {isOverlay ? (
          <button
            type="button"
            onClick={dismiss}
            className="touch-manipulation rounded-md px-3 py-2 text-[15px] font-medium text-[#b7aa95] hover:text-[#f3eadb]"
          >
            Done
          </button>
        ) : (
          <button
            type="button"
            onClick={goBack}
            className="touch-manipulation rounded-md px-3 py-2 text-[15px] font-medium text-[#b7aa95] hover:text-[#f3eadb]"
          >
            Done
          </button>
        )}
      </div>

      <div className="mx-auto mt-5 w-full max-w-md shrink-0">
        <div className="rounded-[1.35rem] border border-[rgba(255,191,112,0.18)] bg-[linear-gradient(160deg,rgba(32,18,36,0.92),rgba(7,17,28,0.96)_58%,rgba(22,14,10,0.94))] p-3 shadow-[0_22px_60px_rgba(0,0,0,0.66),inset_0_0_0_1px_rgba(243,234,219,0.05)]">
          <div className="mb-3 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[#ffbf70]">
              Vinyl Archive Lab
            </p>
            <p
              className="mt-1 text-[clamp(1.45rem,6vw,2rem)] font-semibold leading-none text-[#f8ead4]"
              style={{ fontFamily: "var(--font-pv2-display), ui-serif, Georgia, serif" }}
            >
              Restore the album identity
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <RestorationPanel
              label="Current Edition"
              eyebrow="Source sleeve"
              src={archiveCoverUrl}
              fallbackLabel={row.title}
              remixKey={archiveRemixKey}
            />
            <RestorationPanel
              label="Restored Edition"
              eyebrow={restoredAt ? "Restored identity" : "Archive version"}
              src={restoredCoverUrl}
              fallbackLabel={selected ? row.title : "Choose an archive version"}
              remixKey={restoredRemixKey}
              active={Boolean(selected)}
              restored={Boolean(restoredAt && savedDisplayUrl && !selected)}
            />
          </div>
          {saveSuccess ? (
            <div className="mt-3 rounded-2xl border border-[#ffbf70]/35 bg-[radial-gradient(circle_at_20%_0%,rgba(255,191,112,0.20),transparent_44%),rgba(43,24,18,0.58)] px-4 py-3 text-center shadow-[0_0_30px_rgba(255,123,64,0.16)]">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#ffbf70]">
                Restoration complete
              </p>
              <p className="mt-1 text-[14px] leading-snug text-[#f8ead4]">{saveSuccess}</p>
            </div>
          ) : null}
        </div>

        <p
          className="mt-4 text-center text-[clamp(1.35rem,5.2vw,1.85rem)] font-semibold leading-tight text-[#f3eadb]"
          style={{ fontFamily: "var(--font-pv2-display), ui-serif, Georgia, serif" }}
        >
          {row.title}
        </p>
        <p className="mt-1 text-center text-[clamp(1rem,3.6vw,1.125rem)] text-[#b7aa95]">
          {row.artist}
          {row.year != null ? <span className="tabular-nums text-[#8a7f6f]"> · {row.year}</span> : null}
        </p>

        {/* 3-up candidate grid sits directly under the album metadata so the
            user can scan alternates without scrolling past links. */}
        <div className="mt-5">
          {candidateFetchError ? (
            <div
              role="alert"
              className="mb-3 rounded-xl border border-red-500/35 bg-[rgba(80,28,28,0.22)] px-3 py-2.5 text-center text-[13px] leading-snug text-[#f0dcd8]"
            >
              <p className="font-semibold text-[#f3e6e4]">Unable to scan archive versions.</p>
            </div>
          ) : null}
          {!candidateFetchError && ingestWarnings.length > 0 ? (
            <div
              role="status"
              className="mb-3 rounded-xl border border-amber-500/35 bg-[rgba(120,83,28,0.18)] px-3 py-2.5 text-left text-[12px] leading-snug text-[#f0e6d2]"
            >
              {ingestWarnings.map((w, i) => (
                <p key={i} className="mb-1.5 last:mb-0">
                  {w}
                </p>
              ))}
            </div>
          ) : null}
          {loading && !candidateFetchError ? (
            <p className="mb-3 text-center text-[13px] text-[#8a7f6f]">Scanning archive versions…</p>
          ) : null}
          {displaySlots.length > 0 ? (
            <ul className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {displaySlots.map((c) => {
                const tileUrl = normalizeCandidateArtworkUrl(c.image);
                const active = tileUrl != null && tileUrl === selectedUrl;
                return (
                  <li key={tileUrl ?? `row:${c.url ?? c.title}`} className="relative z-0 list-none">
                    <CandidateTile
                      candidate={c}
                      active={active}
                      hasSelection={hasSelection}
                      onPick={() => {
                        setSelectedUrl(tileUrl);
                        setSaveSuccess(null);
                        setRestoredAt(null);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}
          {!loading && !candidateFetchError && grid.length === 0 ? (
            <p className="mt-4 text-center text-[15px] leading-snug text-[#b7aa95]" role="status">
              No strong archive versions found.
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-center px-2 text-[14px]">
          <a
            href={discogsSearchHref}
            target="retroverse-discogs"
            rel="noopener noreferrer"
            className="text-[#c8a96b] underline decoration-[rgba(200,169,107,0.35)] underline-offset-2 hover:text-[#f3eadb]"
          >
            Search Archive Sources ↗
          </a>
        </div>
        <form onSubmit={submitSave} className="mt-3 px-2">
          <label htmlFor="pv2-curator-paste-url" className="sr-only">
            Paste a Discogs release URL or image URL
          </label>
          {/**
           * Single SAVE row: input + primary save button.
           * Priority when SAVE fires:
           *   1. Non-empty pasted URL → save via the resolve/paste flow.
           *   2. Else a selected tile → save via the candidate flow.
           *   3. Else the button is disabled.
           */}
          <div className="flex items-stretch gap-2">
            <input
              id="pv2-curator-paste-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={pasteUrl}
              onChange={(e) => {
                setPasteUrl(e.target.value);
                if (saveError) setSaveError(null);
                if (saveSuccess) setSaveSuccess(null);
                if (restoredAt) setRestoredAt(null);
              }}
              placeholder="Paste archive source"
              className="min-w-0 flex-1 rounded-xl border border-[rgba(200,169,107,0.35)] bg-[#08111d] px-3 py-3 text-[14px] text-[#f3eadb] shadow-[inset_0_2px_10px_rgba(0,0,0,0.35)] placeholder:text-[#6d6358] focus:border-[#c8a96b] focus:outline-none focus:ring-1 focus:ring-[#c8a96b]/35"
            />
            <button
              type="submit"
              disabled={(pastePending || applyPending) || (pasteUrl.trim().length === 0 && !selected)}
              className={[
                "shrink-0 touch-manipulation whitespace-nowrap rounded-xl px-5 py-3 text-[14px] font-semibold uppercase tracking-[0.18em] transition-opacity",
                pasteUrl.trim().length === 0 && !selected
                  ? "cursor-not-allowed bg-[#08111d] text-[#5c554a] ring-1 ring-[rgba(200,169,107,0.18)]"
                  : "bg-[#c8a96b] text-[#05070b] ring-1 ring-[rgba(243,234,219,0.25)] hover:opacity-95 active:opacity-90",
              ].join(" ")}
            >
              {pastePending || applyPending ? "Restoring…" : "Apply Restoration"}
            </button>
          </div>
          {saveError ? (
            <p role="alert" className="mt-2 text-center text-[12px] leading-snug text-[#f0dcd8]">
              {saveError}
            </p>
          ) : null}
        </form>
      </div>

      <div className="mx-auto mt-10 w-full max-w-md border-t border-[rgba(200,169,107,0.2)] pt-8">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.2em] text-[#c8a96b]">Search the archive</p>
        <form onSubmit={submitSearch} className="flex items-stretch gap-2">
          <label htmlFor="pv2-curator-search" className="sr-only">
            Search artist, album, or year
          </label>
          <input
            id="pv2-curator-search"
            type="search"
            name="q"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Artist, album, year…"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-xl border border-[rgba(200,169,107,0.35)] bg-[#08111d] px-4 py-3 text-[16px] text-[#f3eadb] shadow-[inset_0_2px_12px_rgba(0,0,0,0.35)] placeholder:text-[#6d6358] focus:border-[#c8a96b] focus:outline-none focus:ring-1 focus:ring-[#c8a96b]/35"
          />
          <button
            type="submit"
            className="shrink-0 touch-manipulation whitespace-nowrap rounded-xl border border-[rgba(200,169,107,0.35)] bg-[#08111d] px-5 py-3 text-[14px] font-medium text-[#f3eadb] transition hover:bg-[#0c1624]"
          >
            Search
          </button>
        </form>
      </div>
    </div>
  );
}
