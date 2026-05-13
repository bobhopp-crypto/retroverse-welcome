import type { Metadata } from "next";
import Link from "next/link";

import { computeDiscoverCoverageReport } from "@/lib/discover-coverage";
import { indexPrimaryNav, indexToolsNav } from "@/lib/site-toc";

export const metadata: Metadata = {
  title: "Index · Retroverse",
  description: "Internal navigation and corpus coverage audit.",
};

export const dynamic = "force-dynamic";

function LinkList({ title, rows }: { title: string; rows: { href: string; label: string; note?: string }[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">{title}</h2>
      <ul className="space-y-1.5 text-sm">
        {rows.map((row) => (
          <li key={row.href}>
            <Link href={row.href} className="text-[var(--accent-primary)] underline-offset-2 hover:underline">
              {row.label}
            </Link>
            {row.note ? <span className="text-[var(--text-secondary)]"> — {row.note}</span> : null}
            <span className="ml-2 font-mono text-[0.7rem] text-[var(--text-secondary)]">{row.href}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function IndexPage() {
  const report = await computeDiscoverCoverageReport();
  const droppedFromFeed = report.reviewHidden + report.reviewFixed;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <header className="mb-10">
        <h1 className="font-serif text-2xl text-[var(--text-primary)]">Index</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Discover, Search, and album pages share one corpus: all of <code className="text-xs">retroverse_albums</code>.
          Billboard rows below are a reference subset (import match count), not the feed boundary.
        </p>
      </header>

      <LinkList title="Browse" rows={indexPrimaryNav} />
      <LinkList title="Admin / dev / hidden" rows={indexToolsNav} />

      <section className="mb-10" aria-labelledby="coverage-audit">
        <h2 id="coverage-audit" className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">
          Corpus coverage audit
        </h2>
        <table className="w-full border-collapse text-left text-sm">
          <tbody className="text-[var(--text-primary)]">
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Total rows in retroverse_albums</th>
              <td className="py-2 tabular-nums">{report.totalAlbumsInDb}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Distinct Billboard 200 import album IDs</th>
              <td className="py-2 tabular-nums">{report.billboardMatchAlbumIdsDistinct}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Usable corpus (id + title)</th>
              <td className="py-2 tabular-nums">{report.fullCorpusUsableAlbums}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">With canonical cover path</th>
              <td className="py-2 tabular-nums">{report.withCanonicalCover}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Without cover</th>
              <td className="py-2 tabular-nums">{report.withoutCanonicalCover}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Albums with direct track link (retroverse_tracks.album_id)</th>
              <td className="py-2 tabular-nums">{report.albumsWithDirectTrackLink}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Albums with edition track link (album_tracks → editions)</th>
              <td className="py-2 tabular-nums">{report.albumsWithEditionTrackLink}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Union: albums with any track signal</th>
              <td className="py-2 tabular-nums">{report.albumsWithAnyTrackLink}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Track % of usable albums</th>
              <td className="py-2 tabular-nums">{report.pctAlbumsWithTracks}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Review: hidden + fixed (dropped from feed)</th>
              <td className="py-2 tabular-nums">
                {droppedFromFeed}{" "}
                <span className="text-[var(--text-secondary)]">
                  ({report.reviewHidden} hidden, {report.reviewFixed} fixed)
                </span>
              </td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Review: skipped / reviewed (still in feed)</th>
              <td className="py-2 tabular-nums">
                {report.reviewSkipped} / {report.reviewReviewed}
              </td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Visible in Discover after review filter</th>
              <td className="py-2 tabular-nums">{report.inVisibleDiscoverFeed}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Cover % of usable titles</th>
              <td className="py-2 tabular-nums">{report.pctCoverOfUsable}</td>
            </tr>
            <tr className="border-b border-[var(--card-border)]/50">
              <th className="py-2 pr-4 font-normal text-[var(--text-secondary)]">Visible % of usable corpus</th>
              <td className="py-2 tabular-nums">{report.pctVisibleOfUsable}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
