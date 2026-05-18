/** Per-panel load outcome — workspace shell never depends on all panels succeeding. */
export type PanelStatus = "ok" | "empty" | "unavailable" | "offline";

export type PanelResult<T> = {
  status: PanelStatus;
  source: string;
  items: T[];
  message: string | null;
  error: string | null;
  meta?: Record<string, unknown>;
};

export function formatPanelError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.details === "string") return o.details;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

function isOfflineError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("fetch failed") ||
    m.includes("econnrefused") ||
    m.includes("enotfound") ||
    m.includes("network") ||
    m.includes("supabase") && m.includes("connect") ||
    m.includes("timeout") ||
    m.includes("503") ||
    m.includes("502")
  );
}

function logPanel(
  panel: string,
  source: string,
  level: "ok" | "empty" | "warn" | "error",
  input: Record<string, unknown>,
  detail?: string,
): void {
  const prefix = `[relationship-workspace] panel=${panel} source=${source}`;
  const inputStr = JSON.stringify(input);
  if (level === "ok") {
    console.log(`${prefix} status=ok input=${inputStr}${detail ? ` ${detail}` : ""}`);
  } else if (level === "empty") {
    console.log(`${prefix} status=empty input=${inputStr}${detail ? ` ${detail}` : ""}`);
  } else if (level === "warn") {
    console.warn(`${prefix} status=warn input=${inputStr} ${detail ?? ""}`);
  } else {
    console.error(`${prefix} status=error input=${inputStr} error=${detail ?? "unknown"}`);
  }
}

export async function loadPanel<T>(opts: {
  panel: string;
  source: string;
  input: Record<string, unknown>;
  run: () => Promise<T[]>;
  emptyMessage?: string;
  unavailableMessage?: string;
  offlineMessage?: string;
  meta?: Record<string, unknown>;
}): Promise<PanelResult<T>> {
  try {
    const items = await opts.run();
    const safe = Array.isArray(items) ? items : [];

    if (safe.length === 0) {
      const message = opts.emptyMessage ?? "No results";
      logPanel(opts.panel, opts.source, "empty", opts.input, message);
      return {
        status: "empty",
        source: opts.source,
        items: [],
        message,
        error: null,
        meta: opts.meta,
      };
    }

    logPanel(opts.panel, opts.source, "ok", opts.input, `count=${safe.length}`);
    return {
      status: "ok",
      source: opts.source,
      items: safe,
      message: null,
      error: null,
      meta: opts.meta,
    };
  } catch (err) {
    const error = formatPanelError(err);
    const offline = isOfflineError(error);
    const status: PanelStatus = offline ? "offline" : "unavailable";
    const message = offline
      ? (opts.offlineMessage ?? "Source offline")
      : (opts.unavailableMessage ?? "Unavailable");

    logPanel(opts.panel, opts.source, "error", opts.input, error);

    return {
      status,
      source: opts.source,
      items: [],
      message,
      error,
      meta: opts.meta,
    };
  }
}

export function emptyPanel<T>(
  panel: string,
  source: string,
  input: Record<string, unknown>,
  message: string,
): PanelResult<T> {
  logPanel(panel, source, "empty", input, message);
  return {
    status: "empty",
    source,
    items: [],
    message,
    error: null,
  };
}
