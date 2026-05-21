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

/** Cross-links between track, album, chart, and Retroscope — no new routes. */
export function TrackContinuityStrip({
  artistName,
  artistHref,
  albumHref,
  albumTitle,
  chartYear,
  peakChartWeek,
}: TrackContinuityLinks) {
  const year = chartYear ?? null;
  const items: { href: string; label: string }[] = [];

  if (albumHref && albumTitle) {
    items.push({ href: albumHref, label: `Album · ${albumTitle}` });
  }
  if (peakChartWeek) {
    items.push({ href: trackDeckWeekHref(peakChartWeek), label: "Chart neighbors" });
  }
  if (year != null) {
    items.push({ href: `/albums?year=${year}`, label: `Explore ${year}` });
    items.push({ href: `/album-retroscope`, label: "Retroscope" });
  } else {
    items.push({ href: "/album-retroscope", label: "Retroscope" });
  }
  items.push({ href: artistHref, label: artistName });

  if (!items.length) return null;

  return (
    <nav className="dossier-track-continuity" aria-label="Explore connections">
      <span className="dossier-track-continuity-label">Explore</span>
      <ul className="dossier-track-continuity-list">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="dossier-track-continuity-link">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
