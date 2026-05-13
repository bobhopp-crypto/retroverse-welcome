import { NextResponse } from "next/server";

/**
 * Curator "paste URL" resolver.
 *
 * Accepts a Discogs page URL like:
 *   https://www.discogs.com/release/3957790-...
 *   https://www.discogs.com/master/12345-...
 *
 * and returns the primary cover image URL so the curator can save it through
 * the existing `living-action` endpoint without forcing the user to right-click
 * the cover on Discogs to copy the image link.
 *
 * Direct image URLs (`https://i.discogs.com/...`) do not need this endpoint —
 * the curator client sends them straight to `living-action`.
 *
 * Read-only Discogs proxy; whitelisted in middleware alongside `/candidates`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DISCOGS_UA = "RetroverseCurator/1.0 (+https://retroverse.local)";

function discogsToken(): string {
  return (process.env.DISCOGS_TOKEN ?? process.env.DISCOGS_PERSONAL_TOKEN ?? "").trim();
}

function parseDiscogsPageUrl(raw: string): { kind: "release" | "master"; id: number } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^(www\.)?discogs\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(release|master)\/(\d+)/i);
  if (!m) return null;
  return { kind: m[1]!.toLowerCase() as "release" | "master", id: Number(m[2]) };
}

type DiscogsImage = { uri?: string | null; uri150?: string | null; width?: number | null; type?: string | null };

function pickLargestImage(images?: DiscogsImage[]): string | null {
  if (!images?.length) return null;
  const withUri = images.filter((i) => i.uri || i.uri150);
  if (!withUri.length) return null;
  const primary = withUri.filter((i) => String(i.type ?? "").toLowerCase() === "primary");
  const pool = primary.length ? primary : withUri;
  pool.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const best = pool[0]!;
  return best.uri ?? best.uri150 ?? null;
}

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) {
    return NextResponse.json({ ok: false, error: "missing_url" }, { status: 400 });
  }

  const parsed = parseDiscogsPageUrl(raw);
  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "not_a_discogs_release_or_master_url" },
      { status: 400 },
    );
  }

  const apiUrl = new URL(`https://api.discogs.com/${parsed.kind}s/${parsed.id}`);
  const token = discogsToken();
  if (token) apiUrl.searchParams.set("token", token);

  const res = await fetch(apiUrl, {
    headers: { accept: "application/json", "user-agent": DISCOGS_UA },
  });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: `discogs_${res.status}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    title?: string;
    year?: number | string | null;
    artists?: Array<{ name?: string }>;
    images?: DiscogsImage[];
    uri?: string;
  };

  const imageUrl = pickLargestImage(data.images);
  if (!imageUrl) {
    return NextResponse.json({ ok: false, error: "no_primary_image" }, { status: 404 });
  }

  const title = (data.title ?? "").trim();
  const artist = (data.artists?.[0]?.name ?? "").trim();
  let year: number | null = null;
  if (typeof data.year === "number" && Number.isFinite(data.year) && data.year > 0) {
    year = data.year;
  } else if (typeof data.year === "string") {
    const m = data.year.match(/\d{4}/);
    if (m) year = Number(m[0]);
  }

  /** `data.uri` from Discogs is sometimes a full URL, sometimes a path. Normalize. */
  let pageUrl = raw;
  if (typeof data.uri === "string" && data.uri.length > 0) {
    pageUrl = /^https?:\/\//i.test(data.uri) ? data.uri : `https://www.discogs.com${data.uri}`;
  }

  return NextResponse.json({
    ok: true,
    kind: parsed.kind,
    id: parsed.id,
    imageUrl,
    title: title || null,
    artist: artist || null,
    year,
    pageUrl,
  });
}
