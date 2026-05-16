import type { Metadata } from "next";
import Link from "next/link";

import {
  indexPrimaryNav,
  indexRetroscopeNav,
  indexSecondaryNav,
  indexToolsNav,
} from "@/lib/site-toc";

export const metadata: Metadata = {
  title: "Index · Retroverse",
  description: "Retroverse Welcome — RetroScope and browse routes.",
};

function LinkList({ title, rows }: { title: string; rows: { href: string; label: string; note?: string }[] }) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">{title}</h2>
      <ul className="space-y-2 text-sm">
        {rows.map((row) => (
          <li key={row.href} className="rounded-md border border-[var(--card-border)]/55 bg-[var(--surface)]/40 px-3 py-2.5">
            <Link href={row.href} className="font-medium text-[var(--accent-primary)] underline-offset-2 hover:underline">
              {row.label}
            </Link>
            {row.note ? <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{row.note}</p> : null}
            <p className="mt-1 font-mono text-[0.68rem] text-[var(--text-secondary)]/90">{row.href}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function IndexPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:px-6">
      <header className="mb-10">
        <h1 className="font-serif text-2xl text-[var(--text-primary)]">Retroverse</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          Site index for this app. RetroScope is the primary experience; everything else supports browse, dossiers, and
          curation.
        </p>
      </header>

      <LinkList title="RetroScope" rows={indexRetroscopeNav} />
      <LinkList title="Browse" rows={indexPrimaryNav} />
      <LinkList title="More" rows={indexSecondaryNav} />
      <LinkList title="Internal" rows={indexToolsNav} />

      <p className="text-xs text-[var(--text-secondary)]">
        Full route checklist with file paths:{" "}
        <Link href="/dev-index" className="text-[var(--accent-primary)] underline-offset-2 hover:underline">
          /dev-index
        </Link>
        . Verbose TOC:{" "}
        <Link href="/toc" className="text-[var(--accent-primary)] underline-offset-2 hover:underline">
          /toc
        </Link>
        .
      </p>
    </div>
  );
}
