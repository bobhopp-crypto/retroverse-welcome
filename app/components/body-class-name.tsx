"use client";

import { useEffect } from "react";

function bodyClassTokens(className: string): string[] {
  return className.trim().split(/\s+/).filter(Boolean);
}

export function BodyClassName({ className }: { className: string }) {
  useEffect(() => {
    const tokens = bodyClassTokens(className);
    document.body.classList.add(...tokens);
    return () => {
      document.body.classList.remove(...tokens);
    };
  }, [className]);

  return null;
}
