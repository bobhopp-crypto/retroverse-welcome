export function FiftyYearsAgoSection() {
  return (
    <section className="fifty-years-panel welcome-section mb-14" aria-labelledby="fifty-years-ago">
      <div className="space-y-4">
        <p className="text-sm font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Retroverse feature
        </p>
        <h2
          id="fifty-years-ago"
          className="font-serif text-[1.85rem] leading-tight tracking-tight text-[var(--text-primary)] sm:text-[2.15rem]"
        >
          50 Years Ago This Week
        </h2>
        <p className="text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
          A quick look at one chart moment that still echoes across playlists and memories.
        </p>
      </div>

      <article className="mt-5 border-t border-[var(--card-border)]/75 pt-4">
        <p className="text-base font-semibold text-[var(--text-primary)] sm:text-lg">
          &ldquo;Love Will Keep Us Together&rdquo;
        </p>
        <p className="mt-1 text-base text-[var(--text-secondary)]">Captain &amp; Tennille</p>
        <p className="mt-1 text-sm uppercase tracking-[0.08em] text-[var(--text-secondary)]/90">
          Chart week of May 22, 1976
        </p>
        <p className="mt-3 text-base italic leading-relaxed text-[var(--text-secondary)] sm:text-lg">
          The kind of chorus that once poured out of open car windows and still feels like summer in
          motion.
        </p>
      </article>

      <button
        type="button"
        className="mt-5 inline-flex items-center rounded-full border border-[var(--card-border)] bg-transparent px-4.5 py-2.5 text-base font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
      >
        Explore this week
      </button>
    </section>
  );
}
