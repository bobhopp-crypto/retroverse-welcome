import { AlbumReviewClient } from "./album-review-client";
import { loadCalibrationTierQueuesWithDiagnostics } from "./load-queue";

export const dynamic = "force-dynamic";

export default function ItunesAlbumReviewPage() {
  const { queues, pipeline } = loadCalibrationTierQueuesWithDiagnostics();
  return <AlbumReviewClient queues={queues} pipeline={pipeline} />;
}
