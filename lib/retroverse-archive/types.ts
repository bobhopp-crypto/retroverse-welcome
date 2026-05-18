export type ArchiveArtifactKind =
  | "next-route"
  | "html-static"
  | "legacy-module"
  | "prototype"
  | "screenshot"
  | "export"
  | "v0-export"
  | "sibling-app"
  | "api-route"
  | "public-asset"
  | "other";

export type ArchiveGroup =
  | "chart_systems"
  | "portal_systems"
  | "vdj_systems"
  | "experiments"
  | "exports"
  | "version"
  | "prototype_type";

export type ArchiveArtifact = {
  id: string;
  kind: ArchiveArtifactKind;
  group: ArchiveGroup;
  tags: string[];
  /** Repo-relative path from monorepo root (RETROVERSE_v2). */
  relPath: string;
  /** Human label (route path, filename, or app name). */
  label: string;
  description: string;
  /** ISO mtime */
  modifiedAt: string;
  /** Same-origin href when routable in this app; otherwise null. */
  launchHref: string | null;
  /** Raw viewer for static HTML/assets under monorepo. */
  rawHref: string | null;
  /** Small preview: image URL, iframe URL, or null. */
  previewHref: string | null;
  /** Cached page screenshot (reports/retroverse-archive/screenshots/{id}.png). */
  screenshotHref: string | null;
  workspace: string;
  routableHere: boolean;
};

export type ArchiveScanResult = {
  scannedAt: string;
  monorepoRoot: string;
  workspaces: string[];
  artifactCount: number;
  groups: Record<ArchiveGroup, ArchiveArtifact[]>;
  all: ArchiveArtifact[];
};
