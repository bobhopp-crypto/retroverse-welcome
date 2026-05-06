import type { Metadata } from "next";
import { WelcomeInterestForm } from "./welcome-interest-form";
import { ThemeSwitcher } from "./theme-switcher";

export const metadata: Metadata = {
  title: "Retroverse - Press Play for the Past",
  description:
    "An interactive music time machine: charts, albums, artists, and the moments that shaped our lives.",
};

const bullets = [
  "Chart timelines",
  "Album histories",
  "Artist journeys",
  "Nostalgic discovery",
  "Historical context",
  "Music memories",
];

export default function Home() {
  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="welcome-page mx-auto max-w-xl px-4 py-10 pb-16 sm:px-6 sm:py-14">
        <header className="welcome-masthead mb-12 space-y-5 text-center sm:mb-14 sm:text-left">
          <div className="flex items-start justify-between gap-4">
            <p className="pt-1 text-xs font-medium uppercase tracking-[0.2em] text-[var(--text-secondary)]">
              Early access
            </p>
            <ThemeSwitcher />
          </div>
          <h1 className="font-serif text-[2.75rem] font-normal leading-[1.05] tracking-tight text-[var(--text-primary)] sm:text-6xl">
            Retroverse
          </h1>
          <p className="font-serif text-xl italic text-[var(--text-secondary)] sm:text-2xl">
            Press Play for the Past
          </p>
          <div className="mx-auto h-px max-w-[12rem] bg-[var(--card-border)]/80 sm:mx-0" aria-hidden />
          <p className="max-w-prose text-left text-base leading-relaxed text-[var(--text-primary)] sm:text-lg">
            Retroverse is an interactive music time machine built around the songs, albums, artists,
            and chart moments that shaped our lives.
          </p>
          <p className="max-w-prose text-left text-base leading-relaxed text-[var(--text-secondary)] sm:text-lg">
            Explore music history one week at a time.
          </p>
        </header>

        <section className="welcome-section mb-14 space-y-4" aria-labelledby="what-it-is">
          <h2 id="what-it-is" className="text-lg font-semibold text-[var(--text-primary)]">
            What it is
          </h2>
          <ul className="grid gap-2.5 text-[var(--text-secondary)] sm:grid-cols-2">
            {bullets.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-snug sm:text-base">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--accent-primary)]" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section
          className="welcome-section welcome-note mb-14 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)]/90 p-5 shadow-[var(--card-shadow)] sm:p-6"
          aria-labelledby="early-access"
        >
          <h2 id="early-access" className="mb-3 text-lg font-semibold text-[var(--text-primary)]">
            A note on early access
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
            This project is in active development. You&apos;re seeing an early version while the archive
            and the experience keep growing. Things will shift, fill in, and surprise us along the way.
          </p>
        </section>

        <section className="welcome-section mb-12 space-y-6" aria-labelledby="stay-loop">
          <h2 id="stay-loop" className="text-lg font-semibold text-[var(--text-primary)]">
            Want updates?
          </h2>
          <p className="text-sm leading-relaxed text-[var(--text-secondary)] sm:text-base">
            Leave your email and a thought if you like. No spam - just humans building something we wish
            existed.
          </p>
          <WelcomeInterestForm />
        </section>

        <footer className="border-t border-[var(--card-border)]/70 pt-8 text-center">
          <p className="text-sm italic text-[var(--text-secondary)]">Built by music obsessives.</p>
        </footer>
      </article>
    </div>
  );
}
