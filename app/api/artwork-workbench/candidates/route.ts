import { NextResponse } from "next/server";

/**
 * Artwork workbench candidate search is disabled for this deployment branch.
 * Restore full implementation when `lib/artwork-candidate-fingerprint` and
 * `lib/artwork-storage-model` are available in the build context.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      disabled: true,
      error: "artwork_workbench_candidates_disabled",
      message: "Artwork workbench candidates API is temporarily unavailable.",
    },
    { status: 503 },
  );
}
