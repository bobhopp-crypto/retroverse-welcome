const ENTRY_CARDS = [
  {
    title: "This Week in History",
    description: "Step into one chart week and feel the pulse of that exact moment in time.",
    cta: "Explore now",
    href: "/week",
  },
  {
    title: "Explore a Year",
    description: "Open a year like a worn scrapbook and trace the songs that framed it.",
    cta: "Coming soon",
    href: "#",
  },
  {
    title: "Follow an Artist",
    description: "Travel the turns, breakthroughs, and quiet pivots of a single musical voice.",
    cta: "Coming soon",
    href: "#",
  },
  {
    title: "Rediscover an Album",
    description: "Revisit one record at a time and remember where each track first met your life.",
    cta: "Coming soon",
    href: "#",
  },
] as const;

export function ChooseYourWayInSection() {
  return (
    <section className="choose-way-panel welcome-section mb-14" aria-labelledby="choose-way-in">
      <div className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Begin your path
        </p>
        <h2
          id="choose-way-in"
          className="font-serif text-[1.85rem] leading-tight tracking-tight text-[var(--text-primary)] sm:text-[2.15rem]"
        >
          Choose Your Way In
        </h2>
      </div>

      <div className="mt-5 space-y-3.5">
        {ENTRY_CARDS.map((card) => (
          <article key={card.title} className="choose-way-card">
            <h3 className="font-serif text-[1.45rem] leading-tight text-[var(--text-primary)] sm:text-[1.55rem]">
              {card.title}
            </h3>
            <p className="mt-2 text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
              {card.description}
            </p>
            <a
              href={card.href}
              className="mt-4 inline-flex items-center rounded-full border border-[var(--card-border)] px-4 py-2.5 text-base font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
            >
              {card.cta}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
