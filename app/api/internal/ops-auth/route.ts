import { NextResponse } from "next/server";

const GATE_COOKIE = "retroverse_ops_gate";
const DEFAULT_PIN = "6324";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const pin = typeof body === "object" && body && "pin" in body ? String((body as { pin: unknown }).pin).trim() : "";
  const expected = process.env.RETROVERSE_OPS_PIN?.trim() || DEFAULT_PIN;
  if (pin !== expected) {
    return NextResponse.json({ ok: false, error: "bad_pin" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(GATE_COOKIE, "ok", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
