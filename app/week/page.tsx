import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "This Week in History - Retroverse",
  description: "A doorway into music memory from one chart week.",
};

const additionalSongs = [
  "Listen to What the Man Said - Wings",
  "One of These Nights - Eagles",
  "Sister Golden Hair - America",
  "How Sweet It Is (To Be Loved by You) - James Taylor",
] as const;

export default function WeekPage() {
  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="rv-spread mx-auto max-w-[46rem] px-4 py-10 pb-14 sm:px-6 sm:py-14">
        <header className="rv-spread-head mb-8 space-y-3 sm:mb-10">
          <p className="text-base font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            This Week in History
          </p>
          <h1 className="font-serif text-[2.5rem] leading-[1.03] tracking-tight text-[var(--text-primary)] sm:text-[3.35rem]">
            Love Will Keep Us Together
          </h1>
          <div className="space-y-1">
            <p className="text-xl text-[var(--text-primary)] sm:text-2xl">Captain &amp; Tennille</p>
            <p className="text-base uppercase tracking-[0.08em] text-[var(--text-secondary)]">
              Chart week of June 14, 1975
            </p>
          </div>
        </header>

        <section className="rv-spread-hero mb-9 sm:mb-11" aria-label="Featured memory">
          <div className="rv-spread-hero-image" aria-hidden />
          <div className="rv-spread-hero-tag">No. 1 Record</div>
          <p className="rv-spread-hero-copy text-lg italic leading-relaxed text-[var(--text-primary)] sm:text-xl">
            Bright pianos, an easy swing, and a chorus that felt built for open windows and long roads.
            It was the kind of week where a single song could make the whole season feel lighter.
          </p>
        </section>

        <section className="rv-spread-layers mb-10 sm:mb-12">
          <aside className="rv-spread-note">
            <p className="font-serif text-[1.2rem] leading-snug text-[var(--text-primary)] sm:text-[1.35rem]">
              The chorus felt like summer itself: warm dashboards, city lights, and everyone singing
              ahead of the radio.
            </p>
          </aside>

          <div className="rv-spread-tracklist">
            <h2 className="font-serif text-[1.45rem] leading-tight text-[var(--text-primary)] sm:text-[1.65rem]">
              Also on the air that week
            </h2>
            <ul className="mt-4 space-y-2.5 text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
              {additionalSongs.map((song) => (
                <li key={song} className="flex gap-2.5">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent-primary)]/80" aria-hidden />
                  <span>{song}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="rv-spread-foot mb-10 sm:mb-12">
          <h2 className="font-serif text-[1.45rem] leading-tight text-[var(--text-primary)] sm:text-[1.65rem]">
            Why this week still lingers
          </h2>
          <p className="mt-3 max-w-prose text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            Some chart weeks become memory containers. You don&apos;t just remember the song - you remember
            where it found you, who was there, and what the world felt like for those few bright days.
          </p>
        </section>

        <footer className="pt-2">
          <Link
            href="/"
            className="rv-spread-back inline-flex items-center rounded-full border border-[var(--card-border)] px-3.5 py-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            Back to Retroverse
          </Link>
        </footer>
      </article>
    </div>
  );
}
