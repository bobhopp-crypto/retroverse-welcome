import type { Metadata } from "next";
import Link from "next/link";
import { getAllEras } from "@/lib/eras";

export const metadata: Metadata = {
  title: "Eras · Retroverse",
  description: "Choose a time period — cultural eras as magazine issues, not spreadsheets.",
};

export default function ErasPage() {
  const eras = getAllEras();

  return (
    <div className="min-h-full bg-[#080706] text-[#e8dcc8]">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.22]"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(180,120,70,0.35), transparent 55%), radial-gradient(ellipse 70% 45% at 100% 100%, rgba(70,90,120,0.2), transparent 50%)",
        }}
        aria-hidden
      />
      <article className="relative mx-auto max-w-3xl px-4 py-12 pb-20 sm:px-6 sm:py-16">
        <header className="mb-12 text-center sm:mb-16 sm:text-left">
          <p className="text-[0.68rem] uppercase tracking-[0.28em] text-[#9a7b5c]">Enter a chapter</p>
          <h1 className="mt-4 font-serif text-[2.4rem] leading-[1.05] tracking-tight text-[#f5ebe0] sm:text-[2.85rem]">Eras</h1>
          <p className="mx-auto mt-4 max-w-[40ch] text-sm leading-relaxed text-[#b79c82] sm:mx-0 sm:text-base">
            Each block is a four-year lens on the charts — mood, radio, and what dominated the stack beside your turntable.
          </p>
        </header>

        <ul className="space-y-6 sm:space-y-8">
          {eras.map((era) => (
            <li key={era.slug}>
              <Link
                href={`/eras/${era.slug}`}
                className="group block overflow-hidden rounded-xl border border-[#3d2e22]/65 bg-[#110e0c]/88 shadow-[0_24px_48px_-28px_rgba(0,0,0,0.75)] transition hover:border-[#c49b6a]/35"
              >
                <div
                  className="h-1.5 w-full"
                  style={{
                    background: `linear-gradient(90deg, ${era.accent ?? "#9a7a61"} 0%, transparent 95%)`,
                  }}
                  aria-hidden
                />
                <div className="px-5 py-5 sm:px-7 sm:py-6">
                  <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[#9a7b5c]">{era.years}</p>
                  <h2 className="mt-2 font-serif text-[1.45rem] leading-snug text-[#f3e8db] transition group-hover:text-[#ffefd9] sm:text-[1.65rem]">
                    {era.title}
                  </h2>
                  <p className="mt-2 text-[0.85rem] leading-relaxed text-[#b79c82]/95 sm:text-[0.92rem]">{era.subtitle}</p>
                  <p className="mt-3 line-clamp-2 text-[0.8rem] leading-relaxed text-[#8f735c] sm:line-clamp-3">{era.summary}</p>
                  <p className="mt-4 text-[0.65rem] uppercase tracking-[0.2em] text-[#c49b6a]/90">Open era →</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
