import type { Metadata } from "next";
import Link from "next/link";

import { driveIndexPath } from "@/lib/retroverse-sites/index-store";
import { loadSitesGalleryMeta } from "@/lib/retroverse-sites/gallery-data";
import { resolveDriveScanRoots } from "@/lib/retroverse-sites/roots";

import { SitesGallery } from "./sites-gallery";

export const metadata: Metadata = {
  title: "Sites Museum · Project Archaeology",
  description: "Visual archive of personal site and app experiments under ~/Sites.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RetroverseSitesPage() {
  const meta = loadSitesGalleryMeta();
  const scanRoots = resolveDriveScanRoots();

  return (
    <div className="min-h-screen bg-[#05070a] text-[#e8edf4]">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-8 sm:px-6">
        <header className="mb-8 space-y-3 border-b border-[#2a3340] pb-6">
          <p className="text-xs uppercase tracking-wide text-[#6b7585]">Internal · personal project archaeology</p>
          <h1 className="font-serif text-2xl text-[#f2f6fc]">Sites Museum</h1>
          <p className="max-w-3xl text-sm text-[#9aa3b2]">
            Visual museum under <code className="text-[#c5d0e0]">~/Sites</code> — pick a project, scroll the wall.
            Images load on demand; nothing dumps 20k cards at once.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-[#6b7585]">
            <span>
              Index: <code className="text-[#9aa3b2]">{meta.usingDriveIndex ? "built" : "missing"}</code>
            </span>
            <span>{meta.pageCount.toLocaleString()} entries</span>
            <span>{meta.withPng.toLocaleString()} previews</span>
            <span>{meta.projectSummaries.length} projects</span>
          </div>
          <p className="max-w-3xl text-xs text-[#6b7585]">
            <code className="text-[#9aa3b2]">npm run sites:index</code> · root{" "}
            <code className="text-[#9aa3b2]">{scanRoots.join(", ")}</code> · thumb debug{" "}
            <code className="text-[#9aa3b2]">SITES_IMAGE_DEBUG=1</code>
          </p>
          <p className="text-sm text-[#8b95a5]">
            <Link href="/retroverse-archive" className="text-[#7eb8ff] underline-offset-2 hover:underline">
              /retroverse-archive
            </Link>
            {" · "}
            <Link href="/dev-index" className="text-[#7eb8ff] underline-offset-2 hover:underline">
              /dev-index
            </Link>
          </p>
        </header>

        {!meta.usingDriveIndex ? (
          <p className="mb-6 rounded border border-[#4a3d20] bg-[#1a1508] px-3 py-2 text-sm text-[#d4a853]">
            No index yet. Run <code>npm run sites:index</code> → <code>{driveIndexPath()}</code>
          </p>
        ) : null}

        <SitesGallery meta={meta} />
      </div>
    </div>
  );
}
