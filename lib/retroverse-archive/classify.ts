import type { ArchiveArtifactKind, ArchiveGroup } from "./types";

const CHART_RE =
  /chart|retroscope|billboard|rank|inspector|occupancy|discover|eras?\/|album-retroscope|artist-retroscope|track-retroscope/i;
const PORTAL_RE = /portal/i;
const VDJ_RE = /vdj|virtualdj|virtual-dj|dj-crate|crate/i;
const EXPERIMENT_RE =
  /experiment|retroverse_v3|integrity|portal-stage|chart-inspector|prototype|staging|lab|poc|rumours-proof/i;
const EXPORT_RE = /\/reports\/|\/exports\/|\/export\/|\.md$|inventory|retroverse-rank/i;
const VERSION_RE = /v[23]|welcome-clean|_v3|portal-v2|retroverse_v3/i;

export function inferKind(relPath: string, isDir: boolean): ArchiveArtifactKind {
  const p = relPath.replace(/\\/g, "/");
  if (isDir) return "other";
  if (/\/app\/api\/[^/]+\/route\.(t|j)sx?$/.test(p)) return "api-route";
  if (/\/app\/.*\/page\.(t|j)sx?$/.test(p)) return "next-route";
  if (p.endsWith(".html")) return "html-static";
  if (p.includes(".legacy.")) return "legacy-module";
  if (/\/portal-prototype\//i.test(p) || /prototype/i.test(p)) return "prototype";
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(p) && /(screenshot|prototype|archive|reports|portal-prototype)/i.test(p))
    return "screenshot";
  if (/\/\.v0\//i.test(p) || /\/v0\//i.test(p)) return "v0-export";
  if (EXPORT_RE.test(p)) return "export";
  if (/\/public\//i.test(p) && /\.(png|jpe?g|webp|svg)$/i.test(p)) return "public-asset";
  return "other";
}

export function inferTags(relPath: string, kind: ArchiveArtifactKind): string[] {
  const p = relPath.toLowerCase();
  const tags = new Set<string>();
  if (CHART_RE.test(p)) tags.add("charts");
  if (PORTAL_RE.test(p)) tags.add("portal");
  if (VDJ_RE.test(p)) tags.add("vdj");
  if (EXPERIMENT_RE.test(p)) tags.add("experiment");
  if (EXPORT_RE.test(p)) tags.add("export");
  if (VERSION_RE.test(p)) tags.add("versioned");
  if (/pastel|cream|paper/i.test(p)) tags.add("pastel");
  if (/playback|player|audio/i.test(p)) tags.add("playback");
  if (/ownership|curator|curate/i.test(p)) tags.add("ownership");
  if (/overlay|modal/i.test(p)) tags.add("overlay");
  if (/nav|loft|way-in/i.test(p)) tags.add("navigation");
  if (kind === "legacy-module") tags.add("legacy");
  if (kind === "sibling-app") tags.add("snapshot");
  return [...tags];
}

export function primaryGroup(relPath: string, kind: ArchiveArtifactKind, tags: string[]): ArchiveGroup {
  const p = relPath.toLowerCase();
  if (tags.includes("vdj") || VDJ_RE.test(p)) return "vdj_systems";
  if (tags.includes("portal") || PORTAL_RE.test(p)) return "portal_systems";
  if (tags.includes("charts") || CHART_RE.test(p) || (kind === "next-route" && /retroscope|chart|eras/.test(p)))
    return "chart_systems";
  if (kind === "export" || tags.includes("export")) return "exports";
  if (kind === "v0-export" || tags.includes("experiment") || EXPERIMENT_RE.test(p)) return "experiments";
  if (tags.includes("versioned") || VERSION_RE.test(p)) return "version";
  return "prototype_type";
}

export function inferDescription(relPath: string, kind: ArchiveArtifactKind, label: string): string {
  const p = relPath.toLowerCase();
  if (kind === "next-route") {
    if (p.includes("album-retroscope")) return "Album RetroScope — spatial year × rank chart.";
    if (p.includes("artist-retroscope")) return "Artist RetroScope — year × artist rank.";
    if (p.includes("track-retroscope")) return "Track RetroScope stub (Hot 100 layer).";
    if (p.includes("chart-inspector")) return "Billboard chart inspection lab.";
    if (p.includes("retroverse_v3")) return "Retroverse v3 occupancy / trails prototype.";
    if (p.includes("portal-v2")) return "Portal v2 cinematic shell.";
    if (p.includes("portal-stage")) return "Portal staging shell experiment.";
    if (p.includes("/portal/")) return "Portal v1 immersive browse.";
    if (p.includes("discover")) return "Legacy discover feed (redirects toward RetroScope).";
    if (p.includes("viewer")) return "Legacy viewer entry (redirect).";
    if (p.includes("dev-index") || p.includes("retroverse-archive")) return "Internal developer route index.";
    if (p.includes("integrity")) return "Data integrity audit surface.";
    if (p.includes("ops/")) return "Ops / calibration console.";
    if (p.includes("internal/")) return "Internal tooling route.";
    return `Next.js page route: ${label}`;
  }
  if (kind === "html-static" && p.includes("portal-prototype"))
    return "Standalone portal HTML prototype (cinematic shell, pre-Next).";
  if (kind === "legacy-module") return "Legacy React module kept for reference (not mounted).";
  if (kind === "screenshot") return "Visual capture or design reference image.";
  if (kind === "export") return "Generated export or static report artifact.";
  if (kind === "v0-export") return "v0 design export directory.";
  if (kind === "sibling-app") return "Sibling app snapshot in monorepo (separate package).";
  if (kind === "api-route") return "Next.js API route handler.";
  if (kind === "prototype") return "Prototype sources (HTML/CSS/JSON).";
  return `File: ${label}`;
}
