"use client";

import { useEffect } from "react";

/** Body classes / attrs set by fullscreen or immersive routes — must not leak onto track pages. */
const STALE_BODY_CLASSES = [
  "arv-body-lock",
  "arv-structure-strip",
  "discover-immersive",
  "album-immersive",
  "portal-device",
  "portal-immersive",
  "viewer-immersive",
  "portal-device-body",
] as const;

const STALE_HTML_CLASSES = ["portal-device-html"] as const;

const BODY_STYLE_KEYS = ["overflow", "position", "inset", "width", "height", "touchAction", "overscrollBehavior"] as const;

/**
 * Track dossier pages: one document scroll region, content clears the fixed global header.
 * Clears lock/immersive body state left by Retroscope, Portal, or legacy discover routes.
 */
export function TrackPageBody() {
  useEffect(() => {
    const html = document.documentElement;
    for (const cls of STALE_BODY_CLASSES) document.body.classList.remove(cls);
    for (const cls of STALE_HTML_CLASSES) html.classList.remove(cls);
    for (const key of BODY_STYLE_KEYS) document.body.style.removeProperty(key);

    document.body.classList.add("dossier-body");

    return () => {
      document.body.classList.remove("dossier-body");
    };
  }, []);

  return null;
}
