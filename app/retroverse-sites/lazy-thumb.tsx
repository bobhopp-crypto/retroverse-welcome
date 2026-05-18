"use client";

import { useEffect, useRef, useState } from "react";

import { imageThumbHref } from "@/lib/retroverse-sites/image-urls";

type Props = {
  id: string;
  alt: string;
  className?: string;
};

export function LazyThumb({ id, alt, className }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || failed) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: "240px 0px", threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [failed]);

  const src = near && !failed ? imageThumbHref(id) : undefined;

  return (
    <div ref={rootRef} className={`relative overflow-hidden bg-[#06080c] ${className ?? ""}`}>
      {failed ? (
        <div className="flex h-full min-h-[140px] items-center justify-center text-[0.65rem] text-[#5c6573]">
          No preview
        </div>
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          decoding="async"
          className="h-full w-full max-h-[200px] object-cover object-top"
          onError={() => {
            if (process.env.NODE_ENV === "development") {
              console.warn("[sites-gallery] image failed", { id, url: src });
            }
            setFailed(true);
          }}
        />
      ) : (
        <div className="min-h-[140px] animate-pulse bg-[#121820]" aria-hidden />
      )}
    </div>
  );
}
