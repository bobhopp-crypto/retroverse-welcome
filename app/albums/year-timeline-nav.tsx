import Link from "next/link";

const ANCHOR_YEARS = [1977, 1984, 1991, 2000] as const;

type YearTimelineNavProps = {
  year: number;
  albumCount?: number;
};

export function YearTimelineNav({ year, albumCount }: YearTimelineNavProps) {
  const prev = year - 1;
  const next = year + 1;

  return (
    <nav className="dossier-year-rail" aria-label="Browse chart years">
      <div className="dossier-year-rail-continuum">
        <Link href={`/albums?year=${prev}`} className="dossier-year-rail-step dossier-year-rail-step--ghost">
          ← {prev}
        </Link>
        <span className="dossier-year-rail-now">{year}</span>
        <Link href={`/albums?year=${next}`} className="dossier-year-rail-step dossier-year-rail-step--ghost">
          {next} →
        </Link>
      </div>
      <div className="dossier-year-rail-anchors">
        {ANCHOR_YEARS.map((y) => (
          <Link
            key={y}
            href={`/albums?year=${y}`}
            className="dossier-year-rail-anchor"
            data-active={y === year}
            aria-current={y === year ? "page" : undefined}
          >
            {y}
          </Link>
        ))}
      </div>
      {albumCount != null ? (
        <p className="dossier-year-rail-meta">
          {albumCount.toLocaleString()} albums on Billboard 200 · {year}
        </p>
      ) : null}
    </nav>
  );
}
