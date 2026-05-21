"use client";

import { useState } from "react";

import { ArchivalCoverVoid } from "@/app/components/archival-cover-void";

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
      ) : null}
      {!showImage ? (
        <span className="dossier-cover-frame-void">
          <ArchivalCoverVoid />
        </span>
      ) : null}
    </div>
  );
}
