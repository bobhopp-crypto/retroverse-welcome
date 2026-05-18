"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { EntriesPage } from "@/lib/retroverse-sites/gallery-data";
import type { ProjectSummary } from "@/lib/retroverse-sites/index-store";
import type { SitePageEntry } from "@/lib/retroverse-sites/scan";
import type { SitesGalleryMeta } from "@/lib/retroverse-sites/gallery-data";

import { LazyThumb } from "./lazy-thumb";

const PAGE_SIZE = 48;
const ROW_H = 268;
const GAP = 12;

function useColumns(width: number): number {
  if (width >= 1280) return 4;
  if (width >= 900) return 3;
  if (width >= 560) return 2;
  return 1;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function SiteCard({ page }: { page: SitePageEntry }) {
  const title = page.label.split("/").pop() ?? page.label;
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-md border border-[#252d38] bg-[#0a0e14]">
      {page.hasPng && page.imageHref ? (
        <LazyThumb id={page.id} alt={title} className="shrink-0" />
      ) : (
        <div className="flex min-h-[140px] flex-col items-center justify-center gap-1 bg-[#06080c] px-2 text-center text-[0.65rem] text-[#5c6573]">
          <span>No preview</span>
          {page.htmlRelPath ? (
            <a href={page.launchHref} className="text-[#7eb8ff] hover:underline">
              Open HTML
            </a>
          ) : null}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-1 font-mono text-[0.7rem] text-[#e8edf4]" title={page.label}>
          {title}
        </h3>
        <p className="text-[0.6rem] text-[#6b7585]">{formatDate(page.modifiedAt)}</p>
        <a
          href={page.launchHref}
          className="mt-auto w-fit rounded border border-[#3d4f66] px-2 py-0.5 text-[0.6rem] text-[#c5d4e8] hover:bg-[#121820]"
        >
          Open
        </a>
      </div>
    </article>
  );
}

function VirtualArtifactGrid({
  items,
  total,
  loading,
  onLoadMore,
}: {
  items: SitePageEntry[];
  total: number;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1024);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const cols = useColumns(width);
  const rowCount = Math.ceil(items.length / cols) || 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H + GAP,
    overscan: 4,
  });

  const virtualRows = virtualizer.getVirtualItems();

  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last || loading || items.length >= total) return;
    if (last.index >= rowCount - 3) onLoadMore();
  }, [virtualRows, rowCount, items.length, total, loading, onLoadMore]);

  return (
    <div ref={parentRef} className="h-[min(72vh,900px)] overflow-auto rounded border border-[#2a3340] bg-[#080b10]">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualRows.map((vr) => {
          const start = vr.index * cols;
          const rowItems = items.slice(start, start + cols);
          return (
            <div
              key={vr.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: vr.size,
                transform: `translateY(${vr.start}px)`,
              }}
              className="px-2"
            >
              <div
                className="grid h-full gap-3"
                style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
              >
                {rowItems.map((page) => (
                  <SiteCard key={page.id} page={page} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {loading ? (
        <p className="sticky bottom-0 bg-[#080b10]/90 py-2 text-center text-xs text-[#6b7585]">Loading…</p>
      ) : null}
    </div>
  );
}

function ProjectPicker({
  summaries,
  onSelect,
}: {
  summaries: ProjectSummary[];
  onSelect: (project: string) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: summaries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 6,
  });

  return (
    <div ref={parentRef} className="max-h-[min(70vh,720px)] overflow-auto rounded border border-[#2a3340]">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const p = summaries[vr.index]!;
          return (
            <button
              key={p.project}
              type="button"
              onClick={() => onSelect(p.project)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vr.start}px)`,
              }}
              className="flex w-full items-center justify-between border-b border-[#1e2630] px-4 py-4 text-left hover:bg-[#121820]"
            >
              <span className="font-serif text-base text-[#f0f4fa]">{p.project}</span>
              <span className="font-mono text-xs text-[#6b7585]">
                {p.entries} · html {p.html} · img {p.images}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SitesGallery({ meta }: { meta: SitesGalleryMeta }) {
  const [project, setProject] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [onlyPreview, setOnlyPreview] = useState(false);
  const [items, setItems] = useState<SitePageEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const summaries = useMemo(
    () => [...meta.projectSummaries].sort((a, b) => b.entries - a.entries),
    [meta.projectSummaries],
  );

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 280);
    return () => clearTimeout(t);
  }, [q]);

  const fetchPage = useCallback(
    async (offset: number, replace: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: String(PAGE_SIZE),
        });
        if (project) params.set("project", project);
        if (debouncedQ) params.set("q", debouncedQ);
        if (onlyPreview) params.set("onlyPreview", "1");
        const res = await fetch(`/api/retroverse-sites/entries?${params}`);
        if (!res.ok) throw new Error(`entries ${res.status}`);
        const data = (await res.json()) as EntriesPage;
        setTotal(data.total);
        setItems((prev) => (replace ? data.entries : [...prev, ...data.entries]));
      } finally {
        setLoading(false);
      }
    },
    [project, debouncedQ, onlyPreview],
  );

  useEffect(() => {
    if (project === null && !debouncedQ) {
      setItems([]);
      setTotal(0);
      return;
    }
    setItems([]);
    void fetchPage(0, true);
  }, [project, debouncedQ, onlyPreview, fetchPage]);

  const loadMore = useCallback(() => {
    if (loading || items.length >= total) return;
    void fetchPage(items.length, false);
  }, [loading, items.length, total, fetchPage]);

  const inSearchMode = debouncedQ.length > 0;
  const inGallery = project !== null || inSearchMode;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-[#8b95a5]">
          Search all projects
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (e.target.value.trim()) setProject(null);
            }}
            placeholder="path, name, idea…"
            className="rounded border border-[#2a3340] bg-[#0c1016] px-2 py-1.5 text-sm text-[#e8edf4] outline-none focus:border-[#4a6a8f]"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-[#8b95a5]">
          <input
            type="checkbox"
            checked={onlyPreview}
            onChange={(e) => setOnlyPreview(e.target.checked)}
            className="rounded"
          />
          Only with preview
        </label>
        <p className="text-xs text-[#6b7585] sm:ml-auto">
          {meta.pageCount.toLocaleString()} indexed · {meta.withPng.toLocaleString()} previews
        </p>
      </div>

      {!inGallery ? (
        <>
          <p className="text-sm text-[#9aa3b2]">Choose a project to browse — artifacts load as you scroll.</p>
          <ProjectPicker summaries={summaries} onSelect={setProject} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            {project ? (
              <button
                type="button"
                onClick={() => {
                  setProject(null);
                  setItems([]);
                }}
                className="text-xs text-[#7eb8ff] hover:underline"
              >
                ← All projects
              </button>
            ) : null}
            <h2 className="font-serif text-lg text-[#f0f4fa]">
              {project ?? `Search: ${debouncedQ}`}
              <span className="ml-2 text-sm font-normal text-[#6b7585]">({total.toLocaleString()})</span>
            </h2>
          </div>
          <VirtualArtifactGrid items={items} total={total} loading={loading} onLoadMore={loadMore} />
        </>
      )}
    </div>
  );
}
