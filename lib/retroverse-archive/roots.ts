import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** Monorepo root (RETROVERSE_v2) and the active Next app workspace. */
export function resolveArchiveRoots(): { monorepoRoot: string; appRoot: string } {
  const envRoot = process.env.RETROVERSE_ARCHIVE_ROOT?.trim();
  if (envRoot && existsSync(envRoot)) {
    const appRoot = process.cwd();
    return { monorepoRoot: path.resolve(envRoot), appRoot };
  }

  const appRoot = process.cwd();
  const candidate = path.resolve(appRoot, "../..");
  if (existsSync(path.join(candidate, "apps"))) {
    return { monorepoRoot: candidate, appRoot };
  }
  return { monorepoRoot: appRoot, appRoot };
}

export function listWorkspaceApps(monorepoRoot: string, appRoot: string): string[] {
  const appsDir = path.join(monorepoRoot, "apps");
  if (!existsSync(appsDir)) return [appRoot];

  const names: string[] = [];
  try {
    for (const ent of readdirSync(appsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const full = path.join(appsDir, ent.name);
      if (existsSync(path.join(full, "package.json"))) names.push(full);
    }
  } catch {
    return [appRoot];
  }
  if (!names.includes(appRoot)) names.unshift(appRoot);
  return names.sort((a, b) => a.localeCompare(b));
}
