import { isSchemaCacheSupabaseError } from "@/lib/supabase-in-query";

const COOLDOWN_MS = 90_000;
let disabledUntil = 0;

export function isHomeSearchSupabaseSkipped(): boolean {
  return Date.now() < disabledUntil;
}

export function recordHomeSearchSupabaseFailure(err: unknown): void {
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : String(err ?? "");
  const code =
    err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";

  if (code === "PGRST002" || isSchemaCacheSupabaseError({ message, code }) || /schema cache/i.test(message)) {
    disabledUntil = Date.now() + COOLDOWN_MS;
  }
}
