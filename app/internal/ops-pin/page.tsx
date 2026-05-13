import { Suspense } from "react";

import OpsPinClient from "./ops-pin-client";

export default function OpsPinPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-neutral-600">Loading…</div>}>
      <OpsPinClient />
    </Suspense>
  );
}
