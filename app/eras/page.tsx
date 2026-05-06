import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Eras - Retroverse",
  description: "Explore music history through four-year eras",
};

const eras = [
  {
    id: "1950s-early",
    title: "Early Rock & Roll",
    years: "1950-1953",
    accentColor: "#8B4513", // Saddle brown
    description:
      "The birth of rock and roll. When electric guitars first shook the world and radio changed forever.",
  },
  {
    id: "1950s-late",
    title: "The Golden Age",
    years: "1954-1957",
    accentColor: "#6F4E37", // Chocolate
    description:
      "Elvis, Buddy Holly, and the consolidation of rock. Music became youth culture.",
  },
  {
    id: "1960s-early",
    title: "The British Invasion",
    years: "1958-1961",
    accentColor: "#8B5A3C", // Burlywood4
    description:
      "Folk and soul rising. The sixties began before the calendar said they did.",
  },
  {
    id: "1960s-middle",
    title: "The Transformative Sixties",
    years: "1962-1965",
    accentColor: "#7A6B3C", // Khaki4
    description:
      "The Beatles, Dylan, and Motown. Music became art. Everything changed.",
  },
  {
    id: "1960s-late",
    title: "Psychedelia & Soul",
    years: "1966-1969",
    accentColor: "#8B7355", // Tan4
    description:
      "Woodstock, psychedelia, and the height of soul. Culture exploded in sound.",
  },
  {
    id: "1970s-early",
    title: "Glam & Prog",
    years: "1970-1973",
    accentColor: "#6B5D54", // Taupe4
    description: "David Bowie, Led Zeppelin, and progressive rock took over.",
  },
  {
    id: "1970s-late",
    title: "Disco & Punk",
    years: "1974-1977",
    accentColor: "#7B6D62", // Burlywood4
    description:
      "Disco ruled the clubs. Punk ruled the streets. The decade split in two.",
  },
  {
    id: "1980s-early",
    title: "New Wave & Synth",
    years: "1978-1981",
    accentColor: "#8B7D6B", // Tan
    description: "MTV arrived. Synthesizers became rock. Electronic sounds took over.",
  },
  {
    id: "1980s-middle",
    title: "The MTV Era",
    years: "1982-1985",
    accentColor: "#6B5B4B", // Darkgoldenrod4
    description: "Michael Jackson, Prince, and the visual revolution. Sound became image.",
  },
  {
    id: "1980s-late",
    title: "Hip-Hop Emerges",
    years: "1986-1989",
    accentColor: "#7B6B5B", // Khaki4
    description: "Hip-hop left the Bronx. It was going global, and nothing was the same.",
  },
  {
    id: "1990s-early",
    title: "Grunge & Gangsta",
    years: "1990-1993",
    accentColor: "#8B7B6B", // Burlywood
    description: "Seattle changed everything. Rap became mainstream. Nirvana took over.",
  },
  {
    id: "1990s-late",
    title: "The Alt-Rock Peak",
    years: "1994-1997",
    accentColor: "#7B6B5B", // Chocolate3
    description: "Britpop, nu-metal, and the internet age. Rock one last time.",
  },
  {
    id: "2000s-early",
    title: "The Digital Turn",
    years: "1998-2001",
    accentColor: "#8B6B4B", // Burlywood4
    description: "Y2K, Napster, and the end of the album era begins.",
  },
  {
    id: "2000s-late",
    title: "Streaming Revolution",
    years: "2002-2005",
    accentColor: "#6B5B4B", // Darkgoldenrod4
    description: "iTunes changed music. Digital became real. Albums started to fade.",
  },
];

export default function ErasPage() {
  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-2xl px-4 py-10 pb-16 sm:px-6 sm:py-14">
        <header className="mb-12 space-y-5 sm:mb-14">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              Cultural archive
            </p>
            <h1 className="font-serif text-5xl font-normal leading-tight tracking-tight text-[var(--text-primary)] sm:text-6xl">
              Eras
            </h1>
          </div>
          <div className="h-px bg-[var(--card-border)]/80" aria-hidden />
          <p className="max-w-prose text-base leading-relaxed text-[var(--text-primary)] sm:text-lg">
            Music history organized in four-year eras. Each era captures the defining sounds, artists,
            and cultural moments that shaped generations.
          </p>
        </header>

        <section className="space-y-3" aria-labelledby="eras-list">
          {eras.map((era) => (
            <Link
              key={era.id}
              href={`/eras/${era.id}`}
              className="group block rounded-lg border border-[var(--card-border)]/50 bg-[var(--card-bg)]/40 p-5 transition-all hover:border-[var(--card-border)] hover:bg-[var(--card-bg)]/70 hover:shadow-sm sm:p-6"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="font-serif text-xl font-normal text-[var(--text-primary)] group-hover:text-[var(--text-primary)] sm:text-2xl">
                    {era.title}
                  </h2>
                  <span
                    className="mt-1 inline-block h-3 w-3 rounded-full flex-shrink-0 group-hover:scale-110 transition-transform"
                    style={{ backgroundColor: era.accentColor }}
                    aria-hidden
                  />
                </div>
                <p className="text-sm font-medium text-[var(--text-secondary)] tabular-nums">
                  {era.years}
                </p>
                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                  {era.description}
                </p>
              </div>
            </Link>
          ))}
        </section>
      </article>
    </div>
  );
}
