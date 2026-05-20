import { getIntegrityPool, integrityQuery } from "@/lib/integrity-console/pg";

export { getIntegrityPool, integrityQuery };

export function isCanonicalGraphEnabled(): boolean {
  if (process.env.RETROVERSE_CANONICAL_GRAPH === "0") return false;
  return true;
}

export async function canonicalGraphPing(): Promise<boolean> {
  if (!isCanonicalGraphEnabled()) return false;
  try {
    await integrityQuery<{ ok: number }>("SELECT 1::int AS ok");
    return true;
  } catch {
    return false;
  }
}
