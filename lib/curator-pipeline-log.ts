import { diagLog } from "@/lib/diag-log";

export type CuratorPipelineStep =
  | "artwork_quality"
  | "local_db_write"
  | "local_db_preflight"
  | "local_db_verify"
  | "r2_upload"
  | "r2_verify"
  | "overrides_write"
  | "supabase_mirror"
  | "cache_invalidate"
  | "ui_refresh_hint";

export function curatorPipelineLog(
  step: CuratorPipelineStep,
  payload: Record<string, unknown> & { traceId?: string; ok?: boolean },
): void {
  const row = { step, ...payload };
  if (process.env.NODE_ENV !== "production" || payload.ok === false) {
    console.info("[CURATOR/PIPELINE]", row);
  }
  diagLog(`curator_${step}`, row);
}
