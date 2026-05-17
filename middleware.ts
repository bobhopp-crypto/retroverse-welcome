import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const GATE_COOKIE = "retroverse_ops_gate";

function opsDisabled(): boolean {
  return process.env.RETROVERSE_OPS_DISABLE === "1";
}

function authed(request: NextRequest): boolean {
  return request.cookies.get(GATE_COOKIE)?.value === "ok";
}

/**
 * Portal curator endpoints (read + save). Save must be reachable on production
 * Portal without the ops PIN — same as candidates/resolve.
 */
const PUBLIC_ARTWORK_WORKBENCH = new Set<string>([
  "/api/artwork-workbench/candidates",
  "/api/artwork-workbench/resolve-discogs-url",
  "/api/artwork-workbench/living-action",
]);

export function middleware(request: NextRequest) {
  if (authed(request)) return NextResponse.next();
  if (opsDisabled()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (PUBLIC_ARTWORK_WORKBENCH.has(pathname)) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/api/")) {
    console.error("[CURATOR/API] ops_gate_blocked", {
      pathname,
      method: request.method,
      error: "ops_gate_required",
    });
    return NextResponse.json({ ok: false, error: "ops_gate_required" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/internal/ops-pin";
  const back = `${pathname}${request.nextUrl.search}`;
  url.searchParams.set("next", back);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/ops/:path*",
    "/internal/curator/:path*",
    "/internal/artwork/:path*",
    "/artwork-workbench/:path*",
    "/api/ops/:path*",
    "/api/artwork-workbench/:path*",
    "/api/discover/review-state",
  ],
};
