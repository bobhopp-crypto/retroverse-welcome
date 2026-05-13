import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function InternalArtworkWorkbenchPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-8 sm:px-6">
      <article className="rounded-lg border border-[var(--card-border)]/75 bg-[var(--surface-raised)] p-5">
        <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Archived route</p>
        <h1 className="mt-1 font-serif text-[1.7rem] leading-tight text-[var(--text-primary)]">`/internal/artwork` is frozen</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          The old mixed workbench route has been archived. Curator triage now lives in a dedicated repair surface.
        </p>
        <div className="mt-4">
          <Link
            href="/internal/curator"
            className="inline-flex items-center rounded border border-[var(--card-border)]/80 bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition hover:bg-[var(--surface-raised)]"
          >
            Open Curator Repair Surface
          </Link>
        </div>
      </article>
    </main>
  );
}
