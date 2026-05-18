import type { MetadataRoute } from "next";

/** “Add to Home Screen” / standalone PWA bootstrap for Retroverse Portal. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Retroverse Portal",
    short_name: "Retroverse",
    description: "Search chart tracks, albums, and artists — then step into Retroscope.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "browser"],
    background_color: "#03070a",
    theme_color: "#03070a",
    orientation: "portrait-primary",
    categories: ["music"],
  };
}
