"use client";

import { useEffect } from "react";

/** While /portal is mounted — minimal global header chrome (see globals.css `body.portal-immersive`). */
export default function PortalImmersiveBody() {
  useEffect(() => {
    document.body.classList.add("portal-immersive");
    return () => document.body.classList.remove("portal-immersive");
  }, []);
  return null;
}
