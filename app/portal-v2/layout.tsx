import type { ReactNode } from "react";

import PortalAtmosphere from "./portal-atmosphere";

export default function PortalV2Layout({ children }: { children: ReactNode }) {
  return <PortalAtmosphere>{children}</PortalAtmosphere>;
}
