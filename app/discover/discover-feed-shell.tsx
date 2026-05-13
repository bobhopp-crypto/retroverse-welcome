"use client";

import dynamic from "next/dynamic";

import type { DiscoverEraNav, DiscoverFeedStats, DiscoverPagination, DiscoverStableAlbumRow } from "./discover-feed-types";

const DiscoverFeedLazy = dynamic(() => import("./discover-feed-client"), {
  ssr: false,
  loading: () => (
    <div
      className="flex min-h-dvh w-full items-center justify-center bg-[#0a0807] px-4 text-sm text-[#8f735c]"
      aria-busy="true"
      aria-live="polite"
    >
      Loading Discover…
    </div>
  ),
});

export type DiscoverFeedShellProps = {
  rows: DiscoverStableAlbumRow[];
  stats: DiscoverFeedStats;
  pagination: DiscoverPagination;
  eraNav: DiscoverEraNav;
  /** `all` for home, or era slug — drives /api/discover/feed. */
  eraSlug: string;
};

export default function DiscoverFeedShell(props: DiscoverFeedShellProps) {
  return <DiscoverFeedLazy {...props} />;
}
