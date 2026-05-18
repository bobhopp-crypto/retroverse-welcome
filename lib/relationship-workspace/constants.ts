import { access } from "node:fs/promises";

export const RELATIONSHIP_WORKSPACE_DECISIONS_PATH =
  process.env.RELATIONSHIP_WORKSPACE_DECISIONS_PATH?.trim() ||
  "data/relationship-workspace-decisions.json";

const VDJ_XML_FALLBACKS = [
  "/Users/bobhopp/Documents/VirtualDJ/database.xml",
  "/Users/bobhopp/Library/Application Support/VirtualDJ/database.xml",
];

export async function resolveVdjDatabaseXmlPath(): Promise<string | null> {
  const env = process.env.VDJ_DATABASE_XML_PATH?.trim();
  const candidates = env ? [env, ...VDJ_XML_FALLBACKS] : VDJ_XML_FALLBACKS;
  for (const p of candidates) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function vdjDatabaseXmlPathSync(): string | null {
  const env = process.env.VDJ_DATABASE_XML_PATH?.trim();
  if (env) return env;
  return VDJ_XML_FALLBACKS[1] ?? null;
}
