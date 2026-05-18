import type { Metadata } from "next";
import Link from "next/link";
import { scanRetroverseArchive } from "@/lib/retroverse-archive/scan";
import { SCREENSHOT_DIR_REL } from "@/lib/retroverse-archive/screenshots";

import { ArchiveGallery } from "./archive-gallery";

export const metadata: Metadata = {
  title: "Retroverse Archive · Archaeology",
  description: "Internal excavation browser for historical Retroverse prototypes and routes.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RetroverseArchivePage() {
  const scan = await scanRetroverseArchive();
  const screenshotCount = scan.all.filter((a) => a.screenshotHref).length;

  return (
    <div className="min-h-screen bg-[#05070a] text-[#e8edf4]">
      <div className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-6">
        <header className="mb-8 space-y-3 border-b border-[#2a3340] pb-6">
          <p className="text-xs uppercase tracking-wide text-[#6b7585]">Internal · read-only excavation</p>
          <h1 className="font-serif text-2xl text-[#f2f6fc]">Retroverse Archive</h1>
          <p className="max-w-3xl text-sm text-[#9aa3b2]">
            Unified browser for historical routes, HTML prototypes, sibling app snapshots, and exports across the
            monorepo. Does not import or modify production RetroScope code.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-[#6b7585]">
            <span>
              Root: <code className="text-[#9aa3b2]">{scan.monorepoRoot}</code>
            </span>
            <span>Scanned: {new Date(scan.scannedAt).toLocaleString()}</span>
            <span>{scan.artifactCount} artifacts</span>
            <span>{screenshotCount} screenshots</span>
            <span>Workspaces: {scan.workspaces.join(", ")}</span>
          </div>
          <p className="max-w-3xl text-xs text-[#6b7585]">
            Page thumbnails: run{" "}
            <code className="text-[#9aa3b2]">npm run archive:capture-screenshots</code> while{" "}
            <code className="text-[#9aa3b2]">npm run dev</code> is running (install{" "}
            <code className="text-[#9aa3b2]">playwright</code> first). Saves PNGs to{" "}
            <code className="text-[#9aa3b2]">{SCREENSHOT_DIR_REL}/</code>.
          </p>
          <p className="text-sm text-[#8b95a5]">
            <Link href="/retroverse-sites" className="text-[#7eb8ff] underline-offset-2 hover:underline">
              /retroverse-sites
            </Link>
            {" · "}
            <Link href="/dev-index" className="text-[#7eb8ff] underline-offset-2 hover:underline">
              /dev-index
            </Link>
            {" · "}
            <Link href="/toc" className="text-[#7eb8ff] underline-offset-2 hover:underline">
              /toc
            </Link>
          </p>
        </header>

        <ArchiveGallery scan={scan} />
      </div>
    </div>
  );
}
