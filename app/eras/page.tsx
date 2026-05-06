import type { Metadata } from "next";
import Link from "next/link";
import { getAllEras } from "@/lib/eras";

export const metadata: Metadata = {
  title: "Retroverse Eras",
  description: "Browse Retroverse by four-year cultural eras.",
};

export default function ErasPage() {
  const eras = getAllEras();

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="eras-shell mx-auto px-4 py-10 pb-14 sm:px-6 sm:py-14">
        <header className="eras-head mb-10">
          <div className="mb-3 flex flex-wrap gap-2">
            <Link
              href="/"
              className="inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              Home
            </Link>
            <Link
              href="/week"
              className="inline-flex items-center rounded-full border border-[var(--card-border)] px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              This Week in History
            </Link>
          </div>
          <p className="text-base font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Retroverse archive
          </p>
          <h1 className="mt-2 font-serif text-[2.35rem] leading-[1.07] tracking-tight text-[var(--text-primary)] sm:text-[3rem]">
            Eras
          </h1>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            Four-year chapters from the chart era, organized as cultural snapshots rather than trend
            dashboards.
          </p>
        </header>

        <section aria-label="Era index" className="eras-index space-y-4">
          {eras.map((era) => (
            <Link
              key={era.slug}
              href={`/eras/${era.slug}`}
              className="eras-row block border-l-4 px-3 py-3 transition-colors hover:bg-[var(--surface-muted)]"
              style={{ borderLeftColor: era.accent }}
            >
              <p className="text-sm uppercase tracking-[0.08em] text-[var(--text-secondary)]">{era.years}</p>
              <h2 className="mt-1 font-serif text-[1.45rem] leading-tight text-[var(--text-primary)] sm:text-[1.6rem]">
                {era.title}
              </h2>
              <p className="mt-1 text-sm uppercase tracking-[0.06em] text-[var(--text-secondary)]/90">
                {era.subtitle}
              </p>
              <p className="mt-2 text-base leading-relaxed text-[var(--text-secondary)]">{era.summary}</p>
            </Link>
          ))}
        </section>
      </article>
    </div>
  );
}
