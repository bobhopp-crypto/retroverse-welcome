"use client";

import { useState } from "react";

type AlbumArchiveCoverProps = {
  src: string | null;
  title: string;
  rankLabel?: string | null;
  className?: string;
};

export function AlbumArchiveCover({ src, title, rankLabel, className }: AlbumArchiveCoverProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={`dossier-cover-frame${className ? ` ${className}` : ""}`}>
      {rankLabel ? <span className="dossier-cover-frame-rank">{rankLabel}</span> : null}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          className={loaded ? "is-loaded" : "is-loading"}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="dossier-cover-frame-void" aria-hidden>
          <span className="dossier-cover-frame-void-label">{title.slice(0, 1) || "·"}</span>
        </span>
      )}
    </div>
  );
}
