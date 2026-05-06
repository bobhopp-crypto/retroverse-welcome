"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";

type ThemeId = "vivid" | "dark";

const STORAGE_KEY = "theme";
const THEMES: ThemeId[] = ["vivid", "dark"];
const LABELS: Record<ThemeId, string> = {
  vivid: "Light",
  dark: "Dark",
};

function normalizeThemeId(v: string | null | undefined): ThemeId {
  return v?.toLowerCase() === "dark" ? "dark" : "vivid";
}

function applyTheme(theme: ThemeId) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore storage issues.
  }
}

export function ThemeSwitcher() {
  const mounted = useSyncExternalStore(
    (onStoreChange) => {
      const frame = requestAnimationFrame(onStoreChange);
      return () => cancelAnimationFrame(frame);
    },
    () => true,
    () => false,
  );

  const [activeTheme, setActiveTheme] = useState<ThemeId>(() => {
    if (typeof window === "undefined") {
      return "vivid";
    }
    return normalizeThemeId(localStorage.getItem(STORAGE_KEY));
  });

  useEffect(() => {
    if (!mounted) {
      return;
    }
    applyTheme(activeTheme);
  }, [activeTheme, mounted]);

  if (!mounted) {
    return null;
  }

  return (
    <div
      className="inline-flex shrink-0 rounded-lg border border-[var(--card-border)] bg-[var(--card-bg)] p-0.5"
      role="group"
      aria-label="Theme"
    >
      {THEMES.map((themeId) => (
        <button
          key={themeId}
          type="button"
          className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"
          data-active={activeTheme === themeId}
          onClick={() => {
            setActiveTheme(themeId);
            applyTheme(themeId);
          }}
        >
          {LABELS[themeId]}
        </button>
      ))}
    </div>
  );
}
