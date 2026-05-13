import { ReviewConsoleClient } from "./review-console-client";
import { loadReviewData } from "./load-review-data";

export const dynamic = "force-dynamic";

export default function OpsReviewPage() {
  const rows = loadReviewData();
  return <ReviewConsoleClient initialRows={rows} />;
}
