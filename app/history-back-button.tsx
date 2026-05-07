"use client";

import { useRouter } from "next/navigation";

export function HistoryBackButton({
  className,
  fallbackHref = "/eras",
  label = "Back",
}: {
  className: string;
  fallbackHref?: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
          return;
        }
        router.push(fallbackHref);
      }}
    >
      {label}
    </button>
  );
}
