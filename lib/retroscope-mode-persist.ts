import type { RetroscopeMode } from "@/lib/retroscope-mode";

export const RETROSCOPE_PREFERRED_MODE_KEY = "retroverse:retroscope:preferred-mode:v1";

export function loadRetroscopePreferredMode(): RetroscopeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RETROSCOPE_PREFERRED_MODE_KEY);
    if (raw === "album" || raw === "artist" || raw === "track") return raw;
  } catch {
    /* private mode */
  }
  return null;
}

export function saveRetroscopePreferredMode(mode: RetroscopeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RETROSCOPE_PREFERRED_MODE_KEY, mode);
  } catch {
    /* quota */
  }
}
