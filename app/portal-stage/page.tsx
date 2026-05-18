import type { Metadata } from "next";

import { emptyViewerBootstrap, loadViewerBootstrap } from "@/lib/viewer-scope";

import PortalStageClient from "./portal-stage-client";

export const metadata: Metadata = {
  title: "Portal · Retroverse",
};

export const dynamic = "force-dynamic";

export default async function PortalStagePage() {
  let bootstrap;
  try {
    bootstrap = await loadViewerBootstrap();
  } catch (err) {
    console.error("[portal-stage] bootstrap catch", err);
    bootstrap = emptyViewerBootstrap();
  }

  return <PortalStageClient bootstrap={bootstrap} />;
}
