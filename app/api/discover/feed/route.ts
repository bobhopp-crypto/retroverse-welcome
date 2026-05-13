import { loadDiscoverStableFeed } from "@/app/discover/load-discover-stable";

export const dynamic = "force-dynamic";

const ALL = "all";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const eraRaw = url.searchParams.get("era")?.trim() ?? ALL;
  const eraSlug = eraRaw === "" ? ALL : eraRaw;
  const pageRaw = parseInt(url.searchParams.get("page") ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  try {
    const bundle = await loadDiscoverStableFeed({ eraSlug, page });
    return Response.json(bundle);
  } catch {
    return Response.json({ error: "discover_feed_failed" }, { status: 500 });
  }
}
