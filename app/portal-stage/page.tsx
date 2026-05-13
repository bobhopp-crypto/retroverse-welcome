import type { Metadata } from "next";

import { loadViewerBootstrap } from "@/lib/viewer-scope";

import PortalStageClient from "./portal-stage-client";

export const metadata: Metadata = {
  title: "Portal · Retroverse",
};

export const dynamic = "force-dynamic";

export default async function PortalStagePage() {
  let bootstrap: Awaited<ReturnType<typeof loadViewerBootstrap>> = null;
  try {
    bootstrap = await loadViewerBootstrap();
  } catch {
    bootstrap = null;
  }

  if (!bootstrap) {
    return (
      <div className="portal-stage-main">
        <div className="portal-stage-empty">
          <p>Unable to load albums.</p>
        </div>
      </div>
    );
  }

  return <PortalStageClient bootstrap={bootstrap} />;
}
