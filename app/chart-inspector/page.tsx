import type { Metadata } from "next";

import ChartInspectorClient from "./chart-inspector-client";

export const metadata: Metadata = {
  title: "Chart inspector (internal)",
  robots: { index: false, follow: false },
};

export default async function ChartInspectorPage({
  searchParams,
}: {
  searchParams: Promise<{ album?: string }>;
}) {
  const sp = await searchParams;
  const raw = typeof sp.album === "string" ? sp.album.trim() : "";
  return <ChartInspectorClient initialAlbumId={raw || null} />;
}
