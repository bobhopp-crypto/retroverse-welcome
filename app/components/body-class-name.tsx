"use client";

import { useEffect } from "react";

export function BodyClassName({ className }: { className: string }) {
  useEffect(() => {
    document.body.classList.add(...className.split(" "));
    return () => {
      document.body.classList.remove(...className.split(" "));
    };
  }, [className]);

  return null;
}
