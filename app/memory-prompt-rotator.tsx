"use client";

import { useEffect, useMemo, useState } from "react";

const PROMPTS = [
  "The summer you learned every lyric.",
  "That song from the back seat at night.",
  "The week disco took over.",
  "The album you played until it wore out.",
  "The slow dance. The breakup. The road trip.",
] as const;

const FADE_MS = 550;

function nextDelay() {
  return 4000 + Math.floor(Math.random() * 2000);
}

export function MemoryPromptRotator() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const currentPrompt = useMemo(() => PROMPTS[index], [index]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(mediaQuery.matches);
    updateMotion();
    mediaQuery.addEventListener("change", updateMotion);
    return () => mediaQuery.removeEventListener("change", updateMotion);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    const rotationId = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => {
        setIndex((prev) => (prev + 1) % PROMPTS.length);
        setVisible(true);
      }, FADE_MS);
    }, nextDelay());

    return () => window.clearTimeout(rotationId);
  }, [index, reducedMotion]);

  return (
    <p
      className={`memory-prompt mt-1 text-base text-[var(--text-secondary)] sm:text-lg ${
        reducedMotion || visible ? "opacity-100" : "opacity-0"
      }`}
      aria-live="polite"
    >
      {currentPrompt}
    </p>
  );
}
