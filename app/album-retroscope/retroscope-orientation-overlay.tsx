"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";

import type { RetroscopePersistScope } from "@/lib/retroscope-mode";
import { dismissRetroscopeOrientation } from "@/lib/retroscope-orientation";

export type RetroscopeOrientationTarget = "portal" | "grid" | "controls" | "welcome";

type Step = {
  target: RetroscopeOrientationTarget;
  title: string;
  body: string;
  cta?: string;
};

const STEPS: Step[] = [
  {
    target: "welcome",
    title: "Welcome to Retroscope",
    body: "Swipe through music history. Drag the portal or use the pads to move through chart years and ranks.",
  },
  {
    target: "portal",
    title: "The portal",
    body: "Your current pick lives here — album art, artist signal, or track readout. This is your listening window into the chart.",
  },
  {
    target: "grid",
    title: "The coordinate grid",
    body: "Each square is a chart position — year across, rank down. Tap any cell to jump. Visited squares stay revealed.",
  },
  {
    target: "controls",
    title: "Year, rank & modes",
    body: "Read the year and rank lamps. Switch Album / Artist / Track layers or open the map. Search any year, song, artist, or album from home.",
    cta: "search",
  },
];

type Props = {
  open: boolean;
  scope: RetroscopePersistScope;
  targets: Record<RetroscopeOrientationTarget, RefObject<HTMLElement | null>>;
  searchHref: string | null;
  onClose: () => void;
};

export function RetroscopeOrientationOverlay({ open, scope, targets, searchHref, onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0);
  const [hole, setHole] = useState<DOMRect | null>(null);

  const step = STEPS[stepIndex]!;
  const isLast = stepIndex >= STEPS.length - 1;

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  const measure = useCallback(() => {
    if (!open) {
      setHole(null);
      return;
    }
    const el = targets[step.target].current;
    if (!el) {
      setHole(null);
      return;
    }
    const pad = 10;
    const r = el.getBoundingClientRect();
    setHole({
      x: r.left - pad,
      y: r.top - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
      top: r.top - pad,
      left: r.left - pad,
      right: r.right + pad,
      bottom: r.bottom + pad,
      toJSON: r.toJSON,
    } as DOMRect);
  }, [open, step.target, targets]);

  useLayoutEffect(() => {
    measure();
    if (!open) return;
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, measure, stepIndex]);

  const finish = useCallback(() => {
    dismissRetroscopeOrientation(scope);
    onClose();
    setStepIndex(0);
  }, [onClose, scope]);

  const onNext = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }, [finish, isLast]);

  const onSkip = useCallback(() => {
    finish();
  }, [finish]);

  if (!open) return null;

  return (
    <div className="arv-orient" role="presentation">
      <div className="arv-orient-blocker" aria-hidden />
      {hole ? (
        <div
          className="arv-orient-spotlight"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          aria-hidden
        />
      ) : (
        <div className="arv-orient-scrim" aria-hidden />
      )}
      <div className="arv-orient-card" role="dialog" aria-modal="true" aria-labelledby="arv-orient-title">
        <p className="arv-orient-step" aria-hidden>
          {stepIndex + 1} / {STEPS.length}
        </p>
        <h2 id="arv-orient-title" className="arv-orient-title">
          {step.title}
        </h2>
        <p className="arv-orient-body">{step.body}</p>
        {step.cta === "search" && searchHref ? (
          <Link href={searchHref} className="arv-orient-link" onClick={finish}>
            Open search →
          </Link>
        ) : null}
        <div className="arv-orient-actions">
          <button type="button" className="arv-orient-btn arv-orient-btn--ghost" onClick={onSkip}>
            Skip tour
          </button>
          <button type="button" className="arv-orient-btn arv-orient-btn--primary" onClick={onNext}>
            {isLast ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
