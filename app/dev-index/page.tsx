import type { Metadata } from "next";
import Link from "next/link";

import { getAllEras } from "@/lib/eras";

export const metadata: Metadata = {
  title: "Dev index · Retroverse",
  description: "Developer route checklist with direct links.",
  robots: { index: false, follow: false },
};

const SAMPLE_ALBUM = "RVAL275844";

type Status = "Active" | "Local-first" | "Supabase-dependent" | "Experimental" | "Legacy" | "Broken/fragile";

type Row = {
  href: string;
  label: string;
  file: string;
  statuses: Status[];
  note?: string;
};

function StatusBadges({ statuses }: { statuses: Status[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {statuses.map((s) => (
        <span
          key={s}
          className="rounded border border-[var(--card-border)]/80 px-1.5 py-0.5 text-[0.65rem] uppercase tracking-wide text-[var(--text-secondary)]"
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 border-b border-[var(--card-border)]/60 pb-2 font-sans text-sm font-semibold uppercase tracking-wide text-[var(--text-primary)]">
        {title}
      </h2>
      <ul className="space-y-4 text-sm">
        {rows.map((row) => (
          <li key={row.href} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
            <div className="min-w-0 flex-1 font-mono text-[0.8rem]">
              <Link href={row.href} className="break-all text-[var(--accent-primary)] underline-offset-2 hover:underline">
                {row.href}
              </Link>
            </div>
            <div className="min-w-0 flex-[2] space-y-1">
              <div className="text-[var(--text-primary)]">{row.label}</div>
              <div className="font-mono text-[0.7rem] text-[var(--text-secondary)]">{row.file}</div>
              <StatusBadges statuses={row.statuses} />
              {row.note ? <p className="text-xs text-[var(--text-secondary)]">{row.note}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DevIndexPage() {
  const eras = getAllEras();
  const firstEra = eras[0];
  const eraSampleHref = firstEra ? `/eras/${firstEra.slug}` : "/eras";

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
      <header className="mb-10 space-y-2">
        <p className="text-xs tracking-wide text-[var(--text-secondary)]">Internal · not product UI</p>
        <h1 className="font-serif text-2xl text-[var(--text-primary)]">Dev route index</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Every <code className="text-xs">app/**/page.tsx</code> route, grouped for testing. Pages marked{" "}
          <strong className="font-normal text-[var(--text-primary)]">Supabase-dependent</strong> may show empty or error
          states if Supabase or env keys are unavailable. Sample IDs may 404 if missing from your DB or dossier bundle.
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          Public site map: <Link href="/toc" className="text-[var(--accent-primary)] underline-offset-2 hover:underline">/toc</Link>
        </p>
      </header>

      <Section
        title="Primary"
        rows={[
          {
            href: "/",
            label: "Root — redirects to RetroScope",
            file: "app/page.tsx",
            statuses: ["Active"],
            note: "/ issues 308 to /album-retroscope",
          },
          {
            href: "/welcome",
            label: "Welcome / marketing landing",
            file: "app/welcome/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
            note: "Interest form POST uses Supabase when configured.",
          },
          {
            href: "/week",
            label: "This week (editorial)",
            file: "app/week/page.tsx",
            statuses: ["Active"],
          },
          {
            href: "/random",
            label: "Random weighted jump (artist / album / track / era)",
            file: "app/random/page.tsx",
            statuses: ["Active", "Supabase-dependent", "Broken/fragile"],
            note: "Album targets use title slugs; may not match RVAL dossier URLs.",
          },
        ]}
      />

      <Section
        title="Album / artist / track"
        rows={[
          {
            href: "/albums",
            label: "Album index",
            file: "app/albums/page.tsx",
            statuses: ["Active", "Supabase-dependent", "Broken/fragile"],
            note: "List links use title slugs; detail pages expect RVAL.",
          },
          {
            href: `/albums/${SAMPLE_ALBUM}`,
            label: "Album dossier (sample RVAL)",
            file: "app/albums/[slug]/page.tsx",
            statuses: ["Active", "Local-first"],
            note: "Needs published album-dossiers bundle; 404 if slug missing.",
          },
          {
            href: "/artists",
            label: "Artists index",
            file: "app/artists/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/artists/bee-gees",
            label: "Artist detail (sample slug)",
            file: "app/artists/[slug]/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
            note: "Replace slug if missing in your DB.",
          },
          {
            href: "/tracks",
            label: "Tracks index",
            file: "app/tracks/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/tracks/RVTR000001",
            label: "Track detail (sample id)",
            file: "app/tracks/[id]/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
            note: "Example id from site TOC; may 404 locally.",
          },
        ]}
      />

      <Section
        title="Portal / RetroScope"
        rows={[
          {
            href: "/album-retroscope",
            label: "RetroScope · Album mode",
            file: "app/album-retroscope/page.tsx",
            statuses: ["Active", "Local-first"],
            note: "Coordinates JSON + optional R2 for covers.",
          },
          {
            href: "/artist-retroscope",
            label: "RetroScope · Artist mode",
            file: "app/artist-retroscope/page.tsx",
            statuses: ["Active", "Local-first"],
            note: "Year × artist rank (A1…) from rankings + universe JSON.",
          },
          {
            href: "/track-retroscope",
            label: "RetroScope · Track mode (stub)",
            file: "app/track-retroscope/page.tsx",
            statuses: ["Active", "Local-first"],
            note: "Same engine; Hot 100 layer pending materialization.",
          },
          {
            href: "/portal",
            label: "Portal v1",
            file: "app/portal/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/portal-v2",
            label: "Portal v2",
            file: "app/portal-v2/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/portal-stage",
            label: "Portal staging shell",
            file: "app/portal-stage/page.tsx",
            statuses: ["Active", "Supabase-dependent", "Experimental"],
          },
          {
            href: `/portal-v2/curate?albumId=${SAMPLE_ALBUM}`,
            label: "Curator deep link (v2)",
            file: "app/portal-v2/curate/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
            note: "Invalid albumId redirects to home.",
          },
          {
            href: `/portal/curate?albumId=${SAMPLE_ALBUM}`,
            label: "Curator legacy path → v2",
            file: "app/portal/curate/page.tsx",
            statuses: ["Legacy"],
            note: "Redirect only.",
          },
        ]}
      />

      <Section
        title="Search / index"
        rows={[
          {
            href: "/search",
            label: "Search",
            file: "app/search/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/search?q=captain",
            label: "Search (sample query)",
            file: "app/search/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/site-index",
            label: "Internal index + coverage audit",
            file: "app/index/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/toc",
            label: "Table of contents (public map)",
            file: "app/toc/page.tsx",
            statuses: ["Active"],
          },
          {
            href: "/dev-index",
            label: "This page",
            file: "app/dev-index/page.tsx",
            statuses: ["Active"],
          },
          {
            href: "/eras",
            label: "Eras index",
            file: "app/eras/page.tsx",
            statuses: ["Active", "Local-first"],
            note: "Era metadata from bundled JSON.",
          },
          {
            href: eraSampleHref,
            label: firstEra ? `Era stream (sample: ${firstEra.title})` : "Era stream (open /eras for slug)",
            file: "app/eras/[slug]/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
          {
            href: "/eras/1974-1977",
            label: "Era 1974–1977 canonical graph",
            file: "app/eras/1974-1977/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
          },
        ]}
      />

      <Section
        title="Curator / ops"
        rows={[
          {
            href: "/internal/curator",
            label: "Curator repair / artwork triage",
            file: "app/internal/curator/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
            note: "Ops gate may apply to related APIs in production.",
          },
          {
            href: "/internal/artwork",
            label: "Archived internal artwork notice",
            file: "app/internal/artwork/page.tsx",
            statuses: ["Legacy", "Active"],
          },
          {
            href: "/artwork-workbench",
            label: "Workbench alias",
            file: "app/artwork-workbench/page.tsx",
            statuses: ["Legacy"],
            note: "Redirect → /internal/curator",
          },
          {
            href: "/internal/ops-pin",
            label: "Ops PIN gate",
            file: "app/internal/ops-pin/page.tsx",
            statuses: ["Active"],
          },
          {
            href: "/ops/review",
            label: "Review console",
            file: "app/ops/review/page.tsx",
            statuses: ["Active", "Local-first"],
            note: "Reads local snapshot files under data paths.",
          },
          {
            href: "/ops/itunes-album-review",
            label: "iTunes calibration",
            file: "app/ops/itunes-album-review/page.tsx",
            statuses: ["Active", "Supabase-dependent"],
            note: "Depends on ops APIs / pipeline.",
          },
        ]}
      />

      <Section
        title="Experiments"
        rows={[
          {
            href: "/retroverse_v3",
            label: "Retroverse v3 occupancy / trails",
            file: "app/retroverse_v3/page.tsx",
            statuses: ["Experimental", "Supabase-dependent"],
          },
          {
            href: "/chart-inspector",
            label: "Chart inspector",
            file: "app/chart-inspector/page.tsx",
            statuses: ["Experimental", "Supabase-dependent"],
          },
          {
            href: `/chart-inspector?album=${SAMPLE_ALBUM}`,
            label: "Chart inspector (sample album query)",
            file: "app/chart-inspector/page.tsx",
            statuses: ["Experimental", "Supabase-dependent"],
          },
          {
            href: "/integrity",
            label: "Integrity audits",
            file: "app/integrity/page.tsx",
            statuses: ["Experimental", "Supabase-dependent"],
          },
        ]}
      />

      <Section
        title="Legacy / redirects"
        rows={[
          {
            href: "/discover",
            label: "Old discover home",
            file: "app/discover/page.tsx",
            statuses: ["Legacy"],
            note: "Redirect chain toward RetroScope.",
          },
          {
            href: "/viewer",
            label: "Old viewer",
            file: "app/viewer/page.tsx",
            statuses: ["Legacy"],
            note: "Redirect → /",
          },
        ]}
      />
    </div>
  );
}
