"use client";

import { useMemo, useState } from "react";

import type { ArchiveArtifact, ArchiveGroup, ArchiveScanResult } from "@/lib/retroverse-archive/types";

const GROUP_LABELS: Record<ArchiveGroup, string> = {
  chart_systems: "Chart systems",
  portal_systems: "Portal systems",
  vdj_systems: "VDJ systems",
  experiments: "Experiments",
  exports: "Exports & reports",
  version: "Version snapshots",
  prototype_type: "Prototypes & misc",
};

const GROUP_ORDER: ArchiveGroup[] = [
  "chart_systems",
  "portal_systems",
  "vdj_systems",
  "experiments",
  "version",
  "exports",
  "prototype_type",
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function PreviewPane({ artifact }: { artifact: ArchiveArtifact }) {
  const isImage = /\.(png|jpe?g|webp|gif|svg)$/i.test(artifact.relPath);
  const canIframe =
    !artifact.screenshotHref &&
    !!artifact.previewHref &&
    artifact.kind === "html-static";

  const muted = !artifact.screenshotHref && !isImage && !canIframe;

  return (
    <div
      className={`relative h-28 shrink-0 overflow-hidden border-b border-[#2a3340] bg-[#070a0f] ${
        muted ? "flex items-center justify-center px-2" : ""
      }`}
    >
      {artifact.screenshotHref ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artifact.screenshotHref}
          alt={`Screenshot of ${artifact.label}`}
          className="h-full w-full object-cover object-top"
          loading="lazy"
        />
      ) : isImage && artifact.previewHref ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artifact.previewHref} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
      ) : canIframe && artifact.previewHref ? (
        <iframe
          title={artifact.label}
          src={artifact.previewHref}
          className="pointer-events-none h-[200%] w-[200%] origin-top-left scale-50 border-0"
          sandbox="allow-scripts allow-same-origin"
          loading="lazy"
        />
      ) : (
        <span className="text-center text-[0.65rem] uppercase tracking-wide text-[#6b7585]">
          {artifact.kind}
          {artifact.routableHere ? <span className="mt-1 block normal-case text-[#5c6573]">no screenshot yet</span> : null}
        </span>
      )}
    </div>
  );
}

function ArtifactCard({ artifact }: { artifact: ArchiveArtifact }) {
  const openHref = artifact.launchHref ?? artifact.rawHref;

  return (
    <article className="flex flex-col overflow-hidden rounded border border-[#2a3340] bg-[#0c1016]">
      <PreviewPane artifact={artifact} />
      <div className="flex flex-1 flex-col gap-2 p-3 text-xs">
        <h3 className="font-mono text-sm text-[#e8edf4]">{artifact.label}</h3>
        {artifact.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {artifact.tags.map((t) => (
              <span key={t} className="rounded border border-[#2a3340] px-1 py-0.5 text-[0.6rem] text-[#7d8796]">
                {t}
              </span>
            ))}
          </div>
        ) : null}
        <p className="line-clamp-2 text-[#9aa3b2]">{artifact.description}</p>
        <p className="truncate font-mono text-[0.65rem] text-[#6b7585]" title={artifact.relPath}>
          {artifact.relPath}
        </p>
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <span className="rounded bg-[#151b24] px-1.5 py-0.5 text-[0.6rem] uppercase text-[#8b95a5]">
            {artifact.kind}
          </span>
          <span className="text-[0.65rem] text-[#6b7585]">{artifact.workspace}</span>
          <span className="ml-auto text-[0.65rem] text-[#6b7585]">{formatDate(artifact.modifiedAt)}</span>
        </div>
        {openHref ? (
          <a
            href={openHref}
            target={artifact.launchHref ? undefined : "_blank"}
            rel={artifact.launchHref ? undefined : "noopener noreferrer"}
            className="inline-flex w-fit items-center rounded border border-[#3d4d63] px-2 py-1 text-[0.7rem] text-[#c5d0e0] hover:bg-[#151b24]"
          >
            Open
          </a>
        ) : (
          <span className="text-[0.65rem] text-[#5c6573]">Not routable in this app</span>
        )}
      </div>
    </article>
  );
}

export function ArchiveGallery({ scan }: { scan: ArchiveScanResult }) {
  const [q, setQ] = useState("");
  const [workspace, setWorkspace] = useState<string>("all");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scan.all.filter((a) => {
      if (workspace !== "all" && a.workspace !== workspace) return false;
      if (!needle) return true;
      const hay = `${a.label} ${a.relPath} ${a.description} ${a.tags.join(" ")} ${a.kind}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [scan.all, q, workspace]);

  const filteredGroups = useMemo(() => {
    const byGroup = new Map<ArchiveGroup, ArchiveArtifact[]>();
    for (const g of GROUP_ORDER) byGroup.set(g, []);
    for (const a of filtered) {
      const list = byGroup.get(a.group) ?? [];
      list.push(a);
      byGroup.set(a.group, list);
    }
    return byGroup;
  }, [filtered]);

  return (
    <div className="space-y-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-[#8b95a5]">
          Filter
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="chart, portal, pastel, retroscope…"
            className="rounded border border-[#2a3340] bg-[#0c1016] px-2 py-1.5 text-sm text-[#e8edf4] outline-none focus:border-[#4a6a8f]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[#8b95a5]">
          Workspace
          <select
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            className="rounded border border-[#2a3340] bg-[#0c1016] px-2 py-1.5 text-sm text-[#e8edf4]"
          >
            <option value="all">All ({scan.workspaces.length})</option>
            {scan.workspaces.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-[#6b7585] sm:ml-auto">
          Showing {filtered.length} of {scan.artifactCount} artifacts
        </p>
      </div>

      {GROUP_ORDER.map((group) => {
        const items = filteredGroups.get(group) ?? [];
        if (items.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="mb-3 border-b border-[#2a3340] pb-2 text-sm font-semibold uppercase tracking-wide text-[#c5d0e0]">
              {GROUP_LABELS[group]}
              <span className="ml-2 font-normal text-[#6b7585]">({items.length})</span>
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((a) => (
                <li key={a.id}>
                  <ArtifactCard artifact={a} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
