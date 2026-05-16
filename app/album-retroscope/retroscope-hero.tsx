import { useState } from "react";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-data";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

export function artistSignalVars(cell: RetroscopeCellDTO | null): Record<string, string> | undefined {
  if (!cell || cell.entityKind !== "artist") return undefined;
  const hue = cell.signalHue ?? 200;
  return {
    ["--arv-signal-hue" as string]: String(hue),
    ["--arv-signal-hue-2" as string]: String(cell.signalHueSecondary ?? hue + 48),
    ["--arv-signal-accent" as string]: cell.signalAccent ?? `hsl(${hue} 68% 58%)`,
    ["--arv-signal-warm" as string]: cell.signalAccentWarm ?? `hsl(${hue + 30} 60% 50%)`,
    ["--arv-signal-bloom" as string]: cell.signalBloom ?? `hsl(${hue} 75% 45% / 0.4)`,
  };
}

export function cellNeighborhoodSuffix(
  activeYear: number,
  activeRank: number,
  year: number,
  rank: number,
): string {
  const dy = Math.abs(year - activeYear);
  const dr = Math.abs(rank - activeRank);
  if (dy === 0 && dr === 0) return "";
  if (dy <= 1 && dr <= 1) return " arv-cell--near";
  if (dy <= 2 && dr <= 2 && dy + dr <= 3) return " arv-cell--adjacent";
  return "";
}

export function HeroCover({ cell }: { cell: RetroscopeCellDTO | null }) {
  const [broken, setBroken] = useState(false);
  const url =
    cell && !broken
      ? canonicalCoverPathToUrl(cell.canonicalCoverPath, {
          cacheBust: cell.canonicalCoverCacheBust ?? null,
        })
      : null;
  if (!cell) {
    return <div className="arv-hero-void">No anchor · move or scan</div>;
  }
  if (!url) {
    return <div className="arv-hero-void">Cover unresolved</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="arv-hero-img"
      draggable={false}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

/** Album portal — cover only; readout lives in `.arv-meta` below the portal. */
export function HeroAlbumFocus({ cell }: { cell: RetroscopeCellDTO | null }) {
  return <HeroCover cell={cell} />;
}

export function HeroArtistSignal({ cell }: { cell: RetroscopeCellDTO | null }) {
  if (!cell) {
    return <div className="arv-hero-void">No signal · move or scan</div>;
  }
  return (
    <div className="arv-hero-signal-field" style={artistSignalVars(cell)}>
      <span className="arv-hero-atmo arv-hero-atmo--drift" aria-hidden />
      <span className="arv-hero-atmo arv-hero-atmo--fog" aria-hidden />
      <span className="arv-hero-atmo arv-hero-atmo--interference" aria-hidden />
      <span className="arv-hero-glyph" aria-hidden />
      <span className="arv-hero-signal-bloom" aria-hidden />
      <span className="arv-hero-signal-scan" aria-hidden />
      <div className="arv-hero-float">
        <div className="arv-hero-copy arv-hero-copy--artist">
          <p className="arv-hero-artist-name">{cell.title}</p>
          <div className="arv-hero-artist-detail">
            <div className="arv-hero-artist-stats">
              <span>
                {cell.activeYearsFirst !== null && cell.activeYearsLast !== null
                  ? `${cell.activeYearsFirst}–${cell.activeYearsLast}`
                  : "—"}
              </span>
              {cell.dominantYears && cell.dominantYears.length > 0 ? (
                <span>peak {cell.dominantYears.slice(0, 3).join(" · ")}</span>
              ) : null}
              {typeof cell.peakMomentumScore === "number" ? (
                <span>signal {cell.peakMomentumScore.toFixed(1)}</span>
              ) : null}
              {typeof cell.rankedYearCount === "number" ? (
                <span>{cell.rankedYearCount} ranked yrs</span>
              ) : null}
            </div>
            {(cell.primaryAlbumTitles?.length ?? 0) > 0 ? (
              <p className="arv-hero-artist-line">Albums · {cell.primaryAlbumTitles!.slice(0, 3).join(" · ")}</p>
            ) : null}
            {(cell.primaryTrackTitles?.length ?? 0) > 0 ? (
              <p className="arv-hero-artist-line">Tracks · {cell.primaryTrackTitles!.slice(0, 3).join(" · ")}</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroTrackStub({ cell }: { cell: RetroscopeCellDTO | null }) {
  return (
    <div className="arv-hero-track-stub">
      <span className="arv-hero-track-wave" aria-hidden />
      <span className="arv-hero-track-scan" aria-hidden />
      <div className="arv-hero-float">
        <div className="arv-hero-copy arv-hero-copy--track">
          <p className="arv-hero-artist-name">{cell?.title ?? "Scanning band"}</p>
          {cell ? <p className="arv-hero-artist-line">{cell.artist}</p> : null}
        </div>
      </div>
    </div>
  );
}
