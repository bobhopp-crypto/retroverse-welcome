import { getRetroverseCoverBaseUrl } from "@/lib/canonical-cover-url";
import { emptyViewerBootstrap, loadViewerBootstrap } from "@/lib/viewer-scope";

import PortalV2Client from "./portal-v2-client";

export default async function PortalHomeContent() {
  let bootstrap;
  try {
    bootstrap = await loadViewerBootstrap();
  } catch (err) {
    console.error("[portal-v2] bootstrap catch", err);
    bootstrap = emptyViewerBootstrap();
  }

  const coverBaseUrl = getRetroverseCoverBaseUrl();
  if (!coverBaseUrl) {
    console.error("[portal-v2] missing RETROVERSE_COVER_BASE_URL / NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL");
  }
  return <PortalV2Client bootstrap={bootstrap} coverBaseUrl={coverBaseUrl} />;
}
