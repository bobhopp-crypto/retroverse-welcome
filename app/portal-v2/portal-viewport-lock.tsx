"use client";

import { useEffect } from "react";

/**
 * Locks document scroll while the Retroverse Portal device shell is mounted
 * (#/portal-v2 immersion and home portal).
 */
export default function PortalViewportLock() {
  useEffect(() => {
    document.documentElement.classList.add("portal-device-html");
    document.body.classList.add("portal-device");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.classList.remove("portal-device-html");
      document.body.classList.remove("portal-device");
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return null;
}
