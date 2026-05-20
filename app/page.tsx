import type { Metadata } from "next";
import { Suspense } from "react";

import AskRetroverseClient from "./ask-retroverse-client";

export const metadata: Metadata = {
  title: "Retroverse — Search music history",
  description: "Search artists, albums, and chart history — readable music culture, album by album.",
};

/** Home is the search front door (200 OK — no redirect). */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <AskRetroverseClient />
    </Suspense>
  );
}
