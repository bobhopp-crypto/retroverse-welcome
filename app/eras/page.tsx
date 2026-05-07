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

        <section aria-label="Era index" className="eras-index space-y-2">
          {eras.map((era) => (
            <Link
              key={era.slug}
              href={`/eras/${era.slug}`}
              className="eras-row eras-row--compact block border-l-4 px-3 py-2 transition-colors hover:bg-[var(--surface-muted)]"
              style={{ borderLeftColor: era.accent }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="font-serif text-[1.2rem] leading-tight text-[var(--text-primary)] sm:text-[1.3rem]">
                  {era.years} - {era.title}
                </h2>
                <p className="eras-row-meta text-sm uppercase tracking-[0.06em] text-[var(--text-secondary)]/90">
                  {era.subtitle}
                </p>
              </div>
            </Link>
          ))}
        </section>
      </article>
    </div>
  );
}
