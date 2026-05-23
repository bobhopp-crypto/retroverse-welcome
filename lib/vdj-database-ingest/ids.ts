import { createHash } from "node:crypto";

export function hashToSix(prefix: string, canonical: string): number {
  const digest = createHash("sha1").update(`${prefix}:${canonical}`).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % 1_000_000;
}

export function allocateDeterministicId(
  prefix: "RVIN" | "RVCU",
  key: string,
  used: Set<string>,
): string {
  let probe = hashToSix(prefix, key);
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = `${prefix}${String(probe).padStart(6, "0")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    probe = (probe + 1) % 1_000_000;
  }
  throw new Error(`unable_to_allocate_${prefix}:${key}`);
}

export function trackInstanceId(filepathHash: string, used: Set<string>): string {
  return allocateDeterministicId("RVIN", `vdj_instance::${filepathHash}`, used);
}

export function trackCueId(filepathHash: string, cueNumber: number, used: Set<string>): string {
  return allocateDeterministicId("RVCU", `vdj_cue::${filepathHash}::${cueNumber}`, used);
}
