"use client";

import { useMemo, useState } from "react";

import type { WorkbenchCandidate } from "./data";

type SectionProps = {
  id: string;
  title: string;
  items: WorkbenchCandidate[];
};

function stateBadge(state: WorkbenchCandidate["state"]): string {
  if (state === "canonical") return "Canonical";
  if (state === "staged-high") return "Staged High";
  if (state === "staged-medium") return "Staged Medium";
  return "Unresolved";
}

function livingStateBadge(state: WorkbenchCandidate["artworkState"]): string {
  if (state === "canonical_verified") return "canonical_verified";
  if (state === "provisional") return "provisional";
  if (state === "low_confidence") return "low_confidence";
  if (state === "needs_review") return "needs_review";
  if (state === "manually_corrected") return "manually_corrected";
  return "unresolved";
}

function imageSrc(item: WorkbenchCandidate): string | null {
  if (!item.stagedFilePath) return null;
  if (item.state === "canonical") return item.stagedFilePath;
  return `/api/artwork-workbench/image?path=${encodeURIComponent(item.stagedFilePath)}`;
}

type CandidateChoice = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url: string | null;
};

function trustOverlay(item: WorkbenchCandidate): { tone: "none" | "soft" | "strong" | "urgent"; label: string } {
  if (item.artworkState === "canonical_verified" || item.artworkState === "manually_corrected") {
    return { tone: "none", label: "" };
  }
  if (item.artworkState === "needs_review" || item.artworkState === "provisional") {
    return { tone: "soft", label: "NEEDS REVIEW" };
  }
  if (item.artworkState === "low_confidence") {
    return { tone: "strong", label: "UNVERIFIED" };
  }
  return { tone: "urgent", label: "FIX THIS" };
}

export default function WorkbenchClient({
  canonical,
  stagedHigh,
  stagedMedium,
  unresolved,
}: {
  canonical: WorkbenchCandidate[];
  stagedHigh: WorkbenchCandidate[];
  stagedMedium: WorkbenchCandidate[];
  unresolved: WorkbenchCandidate[];
}) {
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const [replaceTarget, setReplaceTarget] = useState<WorkbenchCandidate | null>(null);
  const [replaceCandidates, setReplaceCandidates] = useState<CandidateChoice[]>([]);
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(false);
  const [artistFilter, setArtistFilter] = useState("");
  const [decadeFilter, setDecadeFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");

  const sections = useMemo<SectionProps[]>(
    () => [
      { id: "unresolved", title: "Unresolved", items: unresolved },
      { id: "staged-medium", title: "Medium-Confidence Staged", items: stagedMedium },
      { id: "staged-high", title: "High-Confidence Staged", items: stagedHigh },
      { id: "canonical", title: "Applied Canonical", items: canonical },
    ],
    [canonical, stagedHigh, stagedMedium, unresolved],
  );

  const artistOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of [...unresolved, ...stagedMedium, ...stagedHigh, ...canonical]) set.add(item.artist);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [canonical, stagedHigh, stagedMedium, unresolved]);

  const decadeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of [...unresolved, ...stagedMedium, ...stagedHigh, ...canonical]) {
      if (item.year === null) continue;
      set.add(`${Math.floor(item.year / 10) * 10}s`);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [canonical, stagedHigh, stagedMedium, unresolved]);

  function includeByFilters(item: WorkbenchCandidate): boolean {
    const id = `${item.runId ?? "canonical"}:${item.albumId}`;
    if (skipped[id]) return false;
    if (showUnresolvedOnly && item.state !== "unresolved") return false;
    if (artistFilter && item.artist !== artistFilter) return false;
    if (decadeFilter !== "all") {
      const decade = item.year === null ? "Unknown" : `${Math.floor(item.year / 10) * 10}s`;
      if (decade !== decadeFilter) return false;
    }
    if (tierFilter !== "all" && item.artworkState !== tierFilter) return false;
    return true;
  }

  async function runLivingAction(
    item: WorkbenchCandidate,
    action: "approve" | "reject" | "clear_artwork" | "replace_artwork" | "mark_verified" | "mark_needs_review",
    overrides?: {
      candidateImageUrl?: string | null;
      replaceSource?: "discogs" | "staged" | null;
      sourceArtist?: string | null;
      sourceCollection?: string | null;
      sourceReleaseDate?: string | null;
    },
  ) {
    const key = `${item.runId ?? "canonical"}:${item.albumId}:${action}`;
    setActionPending(key);
    try {
      const res = await fetch("/api/artwork-workbench/living-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          albumId: item.albumId,
          artist: item.artist,
          title: item.title,
          runId: item.runId,
          confidence: item.confidence,
          stagedFilePath: item.stagedFilePath,
          queryUsed: item.queryUsed,
          normalizedQuery: item.normalizedQuery,
          sourceArtist: overrides?.sourceArtist ?? item.sourceArtist,
          sourceCollection: overrides?.sourceCollection ?? item.sourceCollection,
          sourceReleaseDate: overrides?.sourceReleaseDate ?? item.sourceReleaseDate,
          candidateSource: item.candidateSource,
          candidateImageUrl: overrides?.candidateImageUrl ?? item.candidateSource ?? null,
          replaceSource: overrides?.replaceSource ?? null,
        }),
      });
      if (!res.ok) throw new Error(`living_action_failed_${res.status}`);
      window.location.reload();
    } catch {
      // no-op; keep current data view if mutation fails
    } finally {
      setActionPending(null);
    }
  }

  async function openReplaceDrawer(item: WorkbenchCandidate) {
    setReplaceTarget(item);
    setReplaceCandidates([]);
    setReplaceError(null);
    setReplaceLoading(true);
    try {
      const query = new URLSearchParams({ artist: item.artist, title: item.title });
      const res = await fetch(`/api/artwork-workbench/candidates?${query.toString()}`);
      if (!res.ok) throw new Error(`candidate_fetch_failed_${res.status}`);
      const body = (await res.json()) as { candidates?: CandidateChoice[] };
      setReplaceCandidates(body.candidates ?? []);
    } catch {
      setReplaceError("Could not load candidates right now.");
    } finally {
      setReplaceLoading(false);
    }
  }

  async function applyCandidate(item: WorkbenchCandidate, candidate: CandidateChoice) {
    await runLivingAction(item, "replace_artwork", {
      candidateImageUrl: candidate.image,
      replaceSource: candidate.source,
      sourceArtist: candidate.artist,
      sourceCollection: candidate.title,
      sourceReleaseDate: candidate.year ? `${candidate.year}-01-01` : null,
    });
  }

  function jumpNextUnresolved() {
    const el = document.querySelector("[data-unresolved='1']") as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-8 pb-10">
      <nav className="sticky top-[calc(var(--rv-header-offset)+0.5rem)] z-20 rounded-lg border border-[var(--card-border)]/80 bg-[var(--surface-raised)]/95 px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <a className="rounded border border-[var(--card-border)]/80 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]" href="#unresolved">
            unresolved
          </a>
          <a className="rounded border border-[var(--card-border)]/80 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]" href="#staged-medium">
            medium
          </a>
          <a className="rounded border border-[var(--card-border)]/80 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]" href="#staged-high">
            high
          </a>
          <a className="rounded border border-[var(--card-border)]/80 px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]" href="#canonical">
            canonical
          </a>
        </div>
      </nav>

      <section className="rounded-lg border border-[var(--card-border)]/75 bg-[var(--surface-raised)] px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showUnresolvedOnly}
              onChange={(e) => setShowUnresolvedOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--card-border)]"
            />
            unresolved only
          </label>
          <select
            value={artistFilter}
            onChange={(e) => setArtistFilter(e.target.value)}
            className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value="">all artists</option>
            {artistOptions.map((artist) => (
              <option key={artist} value={artist}>
                {artist}
              </option>
            ))}
          </select>
          <select
            value={decadeFilter}
            onChange={(e) => setDecadeFilter(e.target.value)}
            className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value="all">all decades</option>
            {decadeOptions.map((decade) => (
              <option key={decade} value={decade}>
                {decade}
              </option>
            ))}
          </select>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
          >
            <option value="all">all confidence/review states</option>
            <option value="canonical_verified">canonical_verified</option>
            <option value="provisional">provisional</option>
            <option value="low_confidence">low_confidence</option>
            <option value="needs_review">needs_review</option>
            <option value="manually_corrected">manually_corrected</option>
            <option value="unresolved">unresolved</option>
          </select>
          <button
            type="button"
            onClick={jumpNextUnresolved}
            className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
          >
            next unresolved
          </button>
        </div>
      </section>

      {sections.map((section) => (
        <section id={section.id} key={section.title} className="scroll-mt-[calc(var(--rv-header-offset)+4.5rem)] space-y-3">
          <div className="flex items-end justify-between border-b border-[var(--card-border)]/70 pb-2">
            <h2 className="font-serif text-[1.35rem] text-[var(--text-primary)]">{section.title}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{section.items.filter(includeByFilters).length}</p>
          </div>
          {section.items.filter(includeByFilters).length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No items in this section.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.filter(includeByFilters).map((item) => {
                const key = `${item.runId ?? "canonical"}:${item.albumId}`;
                const img = imageSrc(item) ?? (item.provisional && item.candidateSource ? item.candidateSource : null);
                const overlay = trustOverlay(item);
                const details = detailsOpen[key] ?? false;
                return (
                  <article
                    key={key}
                    data-unresolved={item.state === "unresolved" ? "1" : "0"}
                    className="overflow-hidden rounded-lg border border-[var(--card-border)]/75 bg-[var(--surface-raised)]"
                  >
                    <div className="relative aspect-square w-full bg-[var(--surface)]">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={`${item.title} cover`} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(255,214,170,0.18),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(120,160,210,0.22),transparent_48%),linear-gradient(135deg,rgba(60,54,48,0.9),rgba(30,34,42,0.95))] text-center text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">
                          visual placeholder
                        </div>
                      )}
                      {overlay.tone === "soft" ? (
                        <div className="absolute right-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] tracking-[0.08em] text-white">
                          {overlay.label}
                        </div>
                      ) : null}
                      {overlay.tone === "strong" ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                          <span className="rotate-[-18deg] border border-rose-200/80 bg-rose-950/55 px-3 py-1 text-xs tracking-[0.16em] text-rose-100">
                            {overlay.label}
                          </span>
                        </div>
                      ) : null}
                      {overlay.tone === "urgent" ? (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
                          <span className="rotate-[-14deg] border border-amber-200/85 bg-amber-950/65 px-3 py-1 text-xs tracking-[0.16em] text-amber-100">
                            {overlay.label}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="space-y-1.5 px-3 py-2.5 text-sm">
                      <p className="font-serif text-base leading-tight text-[var(--text-primary)]">{item.title}</p>
                      <p className="text-[var(--text-secondary)]">
                        {item.artist}
                        {item.year ? ` • ${item.year}` : ""}
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                          {livingStateBadge(item.artworkState)}
                        </span>
                        {item.provisional ? (
                          <span className="rounded border border-amber-700/50 bg-amber-950/20 px-2 py-0.5 text-xs text-amber-200">provisional</span>
                        ) : null}
                        {item.confidence !== null ? (
                          <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                            score {item.confidence.toFixed(3)}
                          </span>
                        ) : null}
                        <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                          {stateBadge(item.state)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pt-1.5">
                        <button
                          type="button"
                          disabled={actionPending === `${item.runId ?? "canonical"}:${item.albumId}:approve`}
                          onClick={() => void runLivingAction(item, "approve")}
                          className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)] disabled:opacity-45"
                        >
                          approve
                        </button>
                        <button
                          type="button"
                          disabled={actionPending === `${item.runId ?? "canonical"}:${item.albumId}:reject`}
                          onClick={() => void runLivingAction(item, "reject")}
                          className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)] disabled:opacity-45"
                        >
                          reject
                        </button>
                        <button
                          type="button"
                          onClick={() => setSkipped((curr) => ({ ...curr, [key]: true }))}
                          className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                        >
                          skip
                        </button>
                        <button
                          type="button"
                          onClick={() => void openReplaceDrawer(item)}
                          className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                        >
                          replace artwork
                        </button>
                        <button
                          type="button"
                          onClick={() => setDetailsOpen((curr) => ({ ...curr, [key]: !details }))}
                          className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
                        >
                          {details ? "hide details" : "show details"}
                        </button>
                      </div>
                      {details ? (
                        <div className="space-y-1 border-t border-[var(--card-border)]/60 pt-2 text-xs text-[var(--text-secondary)]">
                          {item.sourceCollection ? <p>Source: {item.sourceArtist} - {item.sourceCollection}</p> : null}
                          {item.appliedAt ? <p>Applied: {new Date(item.appliedAt).toLocaleString()}</p> : null}
                          <p>Query: {item.queryUsed ?? "n/a"}</p>
                          <p>Normalized: {item.normalizedQuery ?? "n/a"}</p>
                          {item.patternCategory ? <p>Pattern: {item.patternCategory}</p> : null}
                          {item.topRejectionReason ? <p>Top rejection: {item.topRejectionReason}</p> : null}
                          {item.topRejected.length > 0 ? (
                            <p>
                              Top candidates:{" "}
                              {item.topRejected.map((candidate) => `${candidate.name} (${candidate.score.toFixed(2)})`).join(" | ")}
                            </p>
                          ) : null}
                          {item.unresolvedReasons.length > 0 ? <p>Failure hints: {item.unresolvedReasons.join(", ")}</p> : null}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ))}

      {replaceTarget ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-3 sm:items-center">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-lg border border-[var(--card-border)]/80 bg-[var(--surface-raised)] p-3">
            <div className="mb-2 flex items-start justify-between gap-3 border-b border-[var(--card-border)]/70 pb-2">
              <div>
                <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Replace Artwork</p>
                <h3 className="font-serif text-lg text-[var(--text-primary)]">{replaceTarget.title}</h3>
                <p className="text-sm text-[var(--text-secondary)]">{replaceTarget.artist}</p>
                <p className="text-xs text-[var(--text-secondary)]">Discogs-assisted manual curation</p>
              </div>
              <button
                type="button"
                onClick={() => setReplaceTarget(null)}
                className="rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                close
              </button>
            </div>
            {replaceLoading ? <p className="text-sm text-[var(--text-secondary)]">Loading candidates...</p> : null}
            {replaceError ? <p className="text-sm text-rose-300">{replaceError}</p> : null}
            {!replaceLoading && !replaceError ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {replaceCandidates.map((candidate, idx) => (
                  <button
                    key={`${candidate.source}-${candidate.artist}-${candidate.title}-${idx}`}
                    type="button"
                    disabled={!candidate.image}
                    onClick={() => void applyCandidate(replaceTarget, candidate)}
                    className="overflow-hidden rounded border border-[var(--card-border)]/75 bg-[var(--surface)] text-left transition hover:bg-[var(--surface-raised)] disabled:opacity-45"
                  >
                    <div className="aspect-square w-full bg-[var(--surface)]">
                      {candidate.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={candidate.image} alt={`${candidate.title} candidate`} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 text-xs text-[var(--text-primary)]">{candidate.title}</p>
                      <p className="line-clamp-1 text-[11px] text-[var(--text-secondary)]">{candidate.artist}</p>
                      <p className="text-[10px] text-[var(--text-secondary)]">
                        {candidate.source} {candidate.year ? `• ${candidate.year}` : ""}
                      </p>
                    </div>
                  </button>
                ))}
                {replaceCandidates.length === 0 ? <p className="col-span-full text-sm text-[var(--text-secondary)]">No candidates found yet.</p> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
