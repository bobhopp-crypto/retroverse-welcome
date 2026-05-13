import type { Metadata } from "next";

import PortalShell from "./portal-shell";
import { loadViewerBootstrap } from "@/lib/viewer-scope";

export const metadata: Metadata = {
  title: "Portal · Retroverse",
  description: "A fixed frame through music history — year by year, album by album.",
};

export const dynamic = "force-dynamic";

export default async function PortalPage() {
  let bootstrap: Awaited<ReturnType<typeof loadViewerBootstrap>> = null;
  try {
    bootstrap = await loadViewerBootstrap();
  } catch {
    bootstrap = null;
  }

  if (!bootstrap) {
    return (
      <div className="flex min-h-[calc(100dvh-var(--rv-header-offset)-1rem)] flex-col items-center justify-center gap-2 px-6 text-center text-[#8a8076]">
        <p className="max-w-[20rem] text-[13px] leading-relaxed">
          Portal can’t load albums (Supabase unavailable, missing env keys, or no rows with{" "}
          <span className="font-mono text-[11px]">release_year</span>).
        </p>
      </div>
    );
  }

  return <PortalShell bootstrap={bootstrap} />;
}
