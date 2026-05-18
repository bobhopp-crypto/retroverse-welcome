export type CuratorRuntimeStrategy = "local_persistent" | "serverless_public";

export function getCuratorRuntimeStrategy(): CuratorRuntimeStrategy {
  if (
    process.env.CURATOR_SQLITE_DISABLED === "1" ||
    process.env.VERCEL === "1" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    return "serverless_public";
  }
  return "local_persistent";
}

export function shouldUseLocalCanonicalDb(): boolean {
  return getCuratorRuntimeStrategy() === "local_persistent";
}

export function isServerlessPublicRuntime(): boolean {
  return getCuratorRuntimeStrategy() === "serverless_public";
}
