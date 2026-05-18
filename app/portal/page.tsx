import type { Metadata } from "next";

import PortalShell from "./portal-shell";
import { emptyViewerBootstrap, loadViewerBootstrap } from "@/lib/viewer-scope";

export const metadata: Metadata = {
  title: "Portal · Retroverse",
  description: "A fixed frame through music history — year by year, album by album.",
};

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  let bootstrap;
  try {
    bootstrap = await loadViewerBootstrap();
  } catch (err) {
    console.error("[portal] page bootstrap catch", err);
    bootstrap = emptyViewerBootstrap();
  }

  return <PortalShell bootstrap={bootstrap} />;
}
