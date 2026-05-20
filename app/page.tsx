import type { Metadata } from "next";
import { Suspense } from "react";

import AskRetroverseClient from "./ask-retroverse-client";

export const metadata: Metadata = {
  title: "Retroverse — Search music history",
  description: "A music time machine — search artists, albums, and chart history.",
};

/** Home is the search front door (200 OK — no redirect). */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <AskRetroverseClient />
    </Suspense>
  );
}
