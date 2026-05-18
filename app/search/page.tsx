import type { Metadata } from "next";
import { Suspense } from "react";

import AskRetroverseClient from "../ask-retroverse-client";

export const metadata: Metadata = {
  title: "Retroverse — Search music history",
  description:
    "Press play for the past. Search chart tracks, albums, and artists — then travel through Retroscope, charts, and your DJ memory trails.",
};

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <AskRetroverseClient />
    </Suspense>
  );
}
