"use client";

import { AlbumCuratorRepair, type CuratorAlbumContext } from "@/app/components/album-curator-repair";

type AlbumPageHeroCuratorProps = {
  context: CuratorAlbumContext;
  className?: string;
  children: React.ReactNode;
};

export function AlbumPageHeroCurator({ context, className = "", children }: AlbumPageHeroCuratorProps) {
  return (
    <AlbumCuratorRepair context={context} showDiscoverReviewActions className={className}>
      {children}
    </AlbumCuratorRepair>
  );
}
