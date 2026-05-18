import type { Metadata } from "next";
import { Suspense } from "react";

import AskRetroverseClient from "./ask-retroverse-client";

export const metadata: Metadata = {
  title: "Ask Retroverse",
  description: "Search chart tracks, albums, artists — and step into Retroscope, Track Deck, and more.",
};

/** Home is the search front door (200 OK — no redirect). */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <AskRetroverseClient />
    </Suspense>
  );
}
