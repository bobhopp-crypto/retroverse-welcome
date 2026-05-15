import { loadOccupancyBundle } from "./load-occupancy";
import RetroverseV3Machine from "./retroverse-v3-machine";

export const revalidate = 3600;

export default async function RetroverseV3Page({
  searchParams,
}: {
  searchParams: Promise<{ occupancy?: string }>;
}) {
  const sp = await searchParams;
  const validate = sp?.occupancy === "validate";
  const bundle = await loadOccupancyBundle(validate);
  return (
    <>
      <RetroverseV3Machine initialTrails={bundle.trails} />
      {validate ? (
        <pre className="rv3-occupancy-validate-dump" suppressHydrationWarning>
          {JSON.stringify({ load: bundle.loadReport, calibration: bundle.calibration }, null, 2)}
        </pre>
      ) : null}
    </>
  );
}
