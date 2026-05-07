import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAllEras, getEraBySlug, type EraYearEntry } from "@/lib/eras";
import { HistoryBackButton } from "@/app/history-back-button";

type EraPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return getAllEras().map((era) => ({ slug: era.slug }));
}

export async function generateMetadata({ params }: EraPageProps): Promise<Metadata> {
  const { slug } = await params;
  const era = getEraBySlug(slug);
  if (!era) {
    return { title: "Era Not Found - Retroverse" };
  }
  return {
    title: `${era.years} - ${era.title} | Retroverse`,
    description: era.summary,
  };
}

function ArchiveList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="era-block">
      <h2 className="font-serif text-[1.35rem] leading-tight text-[var(--text-primary)] sm:text-[1.5rem]">
        {title}
      </h2>
      <ul className="mt-3 space-y-1.5 text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]/70" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <section className="era-block">
      <h2 className="font-serif text-[1.35rem] leading-tight text-[var(--text-primary)] sm:text-[1.5rem]">
        {label}
      </h2>
      <p className="mt-3 text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">{value}</p>
    </section>
  );
}

function YearEntry({ yearData }: { yearData: EraYearEntry }) {
  const fields = [
    { title: "Defining Musical Traits", value: yearData["Defining Musical Traits"] },
    { title: "Emotional Atmosphere", value: yearData["Emotional Atmosphere"] },
    { title: "Chart/Radio Identity", value: yearData["Chart/Radio Identity"] },
    { title: "Major Transitions", value: yearData["Major Transitions"] },
    { title: "Notable Cultural Moments", value: yearData["Notable Cultural Moments"] },
    { title: "Dominant Sounds", value: yearData["Dominant Sounds"] },
    { title: "Artist Breakthroughs", value: yearData["Artist Breakthroughs"] },
  ].filter((field) => field.value && field.value.trim().length > 0);

  return (
    <article className="era-year-block border-l-2 pl-3 sm:pl-4">
      <h3 className="font-serif text-[1.2rem] text-[var(--text-primary)] sm:text-[1.35rem]">{yearData.year}</h3>
      <div className="mt-2 space-y-3">
        {fields.map((field) => (
          <div key={`${yearData.year}-${field.title}`}>
            <p className="text-sm uppercase tracking-[0.07em] text-[var(--text-secondary)]">{field.title}</p>
            <p className="mt-1 text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
              {field.value}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

export default async function EraDetailPage({ params }: EraPageProps) {
  const { slug } = await params;
  const era = getEraBySlug(slug);
  if (!era) {
    notFound();
  }

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="eras-shell mx-auto px-4 py-10 pb-14 sm:px-6 sm:py-14">
        <header className="eras-head mb-9 border-l-4 pl-3 sm:pl-4" style={{ borderLeftColor: era.accent }}>
          <p className="text-base font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">
            Retroverse era archive
          </p>
          <h1 className="mt-2 font-serif text-[2.2rem] leading-[1.08] tracking-tight text-[var(--text-primary)] sm:text-[2.8rem]">
            {era.title}
          </h1>
          <p className="mt-1 text-base uppercase tracking-[0.08em] text-[var(--text-secondary)]">
            {era.years}
          </p>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            {era.summary}
          </p>
        </header>

        <div className="mb-8">
          <HistoryBackButton
            fallbackHref="/eras"
            label="Back"
            className="inline-flex items-center rounded-full border border-[var(--card-border)] px-4 py-2.5 text-base font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
          />
        </div>

        <main className="eras-grid space-y-6">
          <KeyValue label="Cultural shifts" value={era.sections.culturalMood} />
          <KeyValue label="Music movements" value={era.sections.dominantGenres} />
          <KeyValue label="Radio and chart behavior" value={era.sections.chartBehavior} />
          <KeyValue label="Defining artists" value={era.sections.definingArtists} />
          {era.definingAlbums && era.definingAlbums.length > 0 ? (
            <ArchiveList title="Defining albums" items={era.definingAlbums} />
          ) : null}
          {era.definingSongs && era.definingSongs.length > 0 ? (
            <ArchiveList title="Defining songs" items={era.definingSongs} />
          ) : null}
          <KeyValue label="Technology and media changes" value={era.sections.technologyMedia} />
          <KeyValue label="Transition from previous era" value={era.sections.transitionFromPrevious} />
          {era.chronology && era.chronology.length > 0 ? (
            <section className="era-block">
              <h2 className="font-serif text-[1.35rem] leading-tight text-[var(--text-primary)] sm:text-[1.5rem]">
                Year-by-year archive
              </h2>
              <div className="mt-4 space-y-6">
                {era.chronology.map((entry) => (
                  <YearEntry key={entry.year} yearData={entry} />
                ))}
              </div>
            </section>
          ) : null}
        </main>

      </article>
    </div>
  );
}
