import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Deprecated. Use POST /api/ops/itunes-album-review/calibration-action with use_this, try_again, or skip.",
    },
    { status: 410 },
  );
}
