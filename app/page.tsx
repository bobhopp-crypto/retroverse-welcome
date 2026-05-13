import type { Metadata } from "next";

import PortalAtmosphere from "./portal-v2/portal-atmosphere";
import PortalHomeContent from "./portal-v2/portal-home-content";

export const metadata: Metadata = {
  title: "Portal · Retroverse",
  description: "A framed aperture through the archive — year by year, album by album.",
};

/**
 * Homepage = portal experience. No request-specific data (cookies, headers,
 * searchParams), so this can serve from the edge cache. `loadViewerBootstrap`
 * is cached server-side at the data layer; this page-level `revalidate` lets
 * the rendered RSC payload itself be reused across visitors for 5 minutes.
 */
export const revalidate = 300;

/** Primary entry: portal experience (same RSC payload as `/portal-v2`, no redirect hop). */
export default function HomePage() {
  return (
    <PortalAtmosphere>
      <PortalHomeContent />
    </PortalAtmosphere>
  );
}
