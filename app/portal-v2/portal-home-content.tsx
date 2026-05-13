import { loadViewerBootstrap } from "@/lib/viewer-scope";

import PortalV2Client from "./portal-v2-client";

export default async function PortalHomeContent() {
  let bootstrap: Awaited<ReturnType<typeof loadViewerBootstrap>> = null;
  try {
    bootstrap = await loadViewerBootstrap();
  } catch {
    bootstrap = null;
  }

  if (!bootstrap) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="max-w-[22rem] text-[15px] leading-relaxed text-[var(--pv2-muted,#8f8574)]">
          Portal can’t load albums. Check Supabase and <span className="font-mono text-[13px]">release_year</span>{" "}
          coverage.
        </p>
      </div>
    );
  }

  return <PortalV2Client bootstrap={bootstrap} />;
}
