/**
 * Temporary diagnostic logging for stabilization passes.
 * Set RETROVERSE_DIAG=1 in production to enable.
 */
export function diagLog(channel: string, payload: Record<string, unknown>): void {
  const enabled =
    process.env.NODE_ENV !== "production" || process.env.RETROVERSE_DIAG === "1";
  if (!enabled) return;
  console.info(`[diag:${channel}]`, { ts: new Date().toISOString(), ...payload });
}
