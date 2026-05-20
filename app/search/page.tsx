import type { Metadata } from "next";
import { Suspense } from "react";

import AskRetroverseClient from "../ask-retroverse-client";

export const metadata: Metadata = {
  title: "Retroverse — Search music history",
  description: "Search artists, albums, and chart history.",
};

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <AskRetroverseClient />
    </Suspense>
  );
}
