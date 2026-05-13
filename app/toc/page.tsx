import type { Metadata } from "next";
import Link from "next/link";
import { getAllEras } from "@/lib/eras";
import {
  siteTocApiRoutes,
  siteTocDynamicPatterns,
  siteTocInternalPages,
  siteTocStaticPages,
  type SiteTocPattern,
} from "@/lib/site-toc";

export const metadata: Metadata = {
  title: "Site map | Retroverse",
  description: "Table of contents: all routes in Retroverse Welcome.",
};

function TocTable({ rows }: { rows: { href: string; label: string; note?: string }[] }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-[var(--card-border)]/80 text-[0.7rem] tracking-[0.08em] text-[var(--text-secondary)] uppercase">
          <th className="py-2 pr-4 font-medium">URL</th>
          <th className="py-2 pr-4 font-medium">Page</th>
          <th className="py-2 font-medium">Note</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.href} className="border-b border-[var(--card-border)]/50 last:border-0">
            <td className="py-2 pr-4 align-top font-mono text-[0.8rem] text-[var(--text-primary)]">
              <Link href={row.href} className="text-[var(--text-primary)] underline-offset-2 hover:underline">
                {row.href}
              </Link>
            </td>
            <td className="py-2 pr-4 align-top text-[var(--text-primary)]">{row.label}</td>
            <td className="py-2 align-top text-[var(--text-secondary)]">{row.note ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PatternBlock({ item }: { item: SiteTocPattern }) {
  return (
    <div className="space-y-2 rounded-lg border border-[var(--card-border)]/70 bg-[var(--surface-raised)]/40 p-4">
      <p className="font-mono text-[0.85rem] text-[var(--text-primary)]">{item.pattern}</p>
      <p className="text-sm text-[var(--text-primary)]">{item.label}</p>
      {item.note ? <p className="text-xs text-[var(--text-secondary)]">{item.note}</p> : null}
      {item.examples.length > 0 ? (
        <ul className="mt-2 max-h-64 list-inside list-disc space-y-1 overflow-y-auto text-sm">
          {item.examples.map((ex) => (
            <li key={ex.href}>
              <Link href={ex.href} className="font-mono text-[0.8rem] underline-offset-2 hover:underline">
                {ex.href}
              </Link>
              <span className="text-[var(--text-secondary)]"> — {ex.label}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function TableOfContentsPage() {
  const eras = getAllEras();
  const eraPattern: SiteTocPattern = {
    pattern: "/eras/[slug]",
    label: "Era archive detail (static generation from eras.json)",
    examples: eras.map((e) => ({ href: `/eras/${e.slug}`, label: `${e.years} — ${e.title}` })),
  };

  const dynamicWithEras = siteTocDynamicPatterns.map((p) => (p.pattern === "/eras/[slug]" ? eraPattern : p));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-14 pt-8 sm:px-6">
      <header className="mb-10 space-y-2">
        <p className="text-xs tracking-[0.12em] text-[var(--text-secondary)] uppercase">Reference</p>
        <h1 className="font-serif text-[1.85rem] leading-tight text-[var(--text-primary)]">Table of contents</h1>
        <p className="max-w-prose text-sm text-[var(--text-secondary)]">
          All user-facing paths and API endpoints in this app. Dynamic segments list example URLs or every prerendered era.
        </p>
      </header>

      <nav className="space-y-10" aria-label="Site structure">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">Static pages</h2>
          <TocTable rows={siteTocStaticPages} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">Dynamic routes</h2>
          <div className="space-y-4">
            {dynamicWithEras.map((p) => (
              <PatternBlock key={p.pattern} item={p} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">Internal / tools</h2>
          <TocTable rows={siteTocInternalPages} />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-[var(--text-primary)]">API routes</h2>
          <TocTable rows={siteTocApiRoutes} />
        </section>
      </nav>
    </div>
  );
}
