import WorkbenchClient from "@/app/artwork-workbench/workbench-client";
import { loadWorkbenchData } from "@/app/artwork-workbench/data";

export const dynamic = "force-dynamic";

export default async function InternalCuratorPage() {
  const data = await loadWorkbenchData();
  const triageTotal = data.unresolved.length + data.stagedMedium.length + data.stagedHigh.length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-6">
      <header className="mb-5 space-y-2 border-b border-[var(--card-border)]/70 pb-4">
        <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Curator Repair Surface</p>
        <h1 className="font-serif text-[1.9rem] leading-tight text-[var(--text-primary)] sm:text-[2.2rem]">
          Artwork Triage
        </h1>
        <p className="max-w-3xl text-sm text-[var(--text-secondary)]">
          Dedicated repair workflow for unresolved and low-trust artwork. Production browsing stays clean; this surface handles rapid correction.
        </p>
        <div className="flex flex-wrap gap-2 pt-1 text-xs text-[var(--text-secondary)]">
          <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-1">triage {triageTotal}</span>
          <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-1">unresolved {data.unresolved.length}</span>
          <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-1">needs review {data.stagedMedium.length}</span>
          <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-1">provisional {data.stagedHigh.length}</span>
          <span className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-2 py-1">verified {data.canonical.length}</span>
        </div>
      </header>
      <WorkbenchClient canonical={data.canonical} stagedHigh={data.stagedHigh} stagedMedium={data.stagedMedium} unresolved={data.unresolved} />
    </main>
  );
}
