import type { Metadata } from "next";

import PortalHomeContent from "./portal-home-content";

export const metadata: Metadata = {
  title: "Portal · Retroverse",
  description: "A framed aperture through the archive — year by year, album by album.",
};
/** Same payload as `/`; share the same edge cache window. */
export const revalidate = 300;

export default PortalHomeContent;
