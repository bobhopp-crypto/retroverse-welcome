import type { RetroscopePersistScope } from "@/lib/retroscope-mode";

const STORAGE_PREFIX = "retroverse:retroscope-orientation:v1";

function storageKey(scope: RetroscopePersistScope): string {
  return `${STORAGE_PREFIX}:${scope}`;
}

export function isRetroscopeOrientationDismissed(scope: RetroscopePersistScope): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(storageKey(scope));
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { dismissed?: boolean };
    return parsed.dismissed === true;
  } catch {
    return false;
  }
}

export function dismissRetroscopeOrientation(scope: RetroscopePersistScope): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      storageKey(scope),
      JSON.stringify({ dismissed: true, dismissedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearRetroscopeOrientationDismissed(scope: RetroscopePersistScope): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(storageKey(scope));
  } catch {
    /* ignore */
  }
}
