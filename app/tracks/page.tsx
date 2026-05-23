import { redirect } from "next/navigation";

type TracksPageProps = {
  searchParams: Promise<{ q?: string; artist?: string; offset?: string }>;
};

/** Tracks index removed — chart deck is the canonical exploration surface. */
export default async function TracksIndexPage({ searchParams }: TracksPageProps) {
  const params = await searchParams;
  const next = new URLSearchParams();
  if (params.q?.trim()) next.set("q", params.q.trim());
  if (params.artist?.trim()) next.set("artist", params.artist.trim());
  const qs = next.toString();
  redirect(qs ? `/track-deck?${qs}` : "/track-deck");
}
