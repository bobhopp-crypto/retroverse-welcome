import type { ViewerBootstrap } from "@/lib/viewer-scope";

import PortalClient from "./portal-client";

export default function PortalShell({ bootstrap }: { bootstrap: ViewerBootstrap }) {
  return <PortalClient bootstrap={bootstrap} />;
}
