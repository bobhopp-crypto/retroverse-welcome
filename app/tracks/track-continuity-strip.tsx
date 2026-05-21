import Link from "next/link";

import { trackDeckWeekHref } from "@/lib/retroverse-nav";

export type TrackContinuityLinks = {
  artistName: string;
  artistHref: string;
  albumHref?: string | null;
  albumTitle?: string | null;
  chartYear?: number | null;
  peakChartWeek?: string | null;
};

type RailItem = {
  href: string;
  label: string;
  glyph: string;
};

function albumRailLabel(title: string): string {
  const t = title.trim();
  if (t.length <= 22) return t;
  return "Album";
}

/** Cross-links between track, album, chart, and Retroscope — tactile editorial rail. */
export function TrackContinuityStrip({
  artistName,
  artistHref,
  albumHref,
  albumTitle,
  chartYear,
  peakChartWeek,
}: TrackContinuityLinks) {
  const year = chartYear ?? null;
  const items: RailItem[] = [];

  if (albumHref && albumTitle) {
    items.push({ href: albumHref, label: albumRailLabel(albumTitle), glyph: "▣" });
  }
  if (peakChartWeek) {
    items.push({ href: trackDeckWeekHref(peakChartWeek), label: "Neighbors", glyph: "◇" });
  }
  if (year != null) {
    items.push({ href: `/albums?year=${year}`, label: String(year), glyph: "⌁" });
    items.push({ href: "/album-retroscope", label: "Retroscope", glyph: "◎" });
  } else {
    items.push({ href: "/album-retroscope", label: "Retroscope", glyph: "◎" });
  }
  const artistLabel = artistName.trim();
  if (artistLabel) {
    items.push({
      href: artistHref,
      label: artistLabel.length > 20 ? `${artistLabel.slice(0, 18)}…` : artistLabel,
      glyph: "✦",
    });
  }

  if (!items.length) return null;

  return (
    <nav className="dossier-track-continuity dossier-track-continuity--rail" aria-label="Explore connections">
      <ul className="dossier-track-continuity-rail">
        {items.map((item, index) => (
          <li key={item.href} className="dossier-track-continuity-rail-item">
            {index > 0 ? <span className="dossier-track-continuity-sep" aria-hidden /> : null}
            <Link href={item.href} className="dossier-track-continuity-etch">
              <span className="dossier-track-continuity-etch-glyph" aria-hidden>
                {item.glyph}
              </span>
              <span className="dossier-track-continuity-etch-label">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
