import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const parsed = body as { email?: unknown; feedback?: unknown };
  const email = typeof parsed.email === "string" ? parsed.email.trim().toLowerCase() : "";
  const feedback = typeof parsed.feedback === "string" ? parsed.feedback.trim().slice(0, 2000) : "";

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  let error: { message?: string; code?: string } | null = null;
  try {
    const supabase = createClient();
    const result = await supabase.from("welcome_interest").insert({
      email,
      feedback: feedback.length > 0 ? feedback : null,
    });
    error = result.error;
  } catch (clientErr) {
    error =
      clientErr instanceof Error
        ? { message: clientErr.message }
        : { message: "Unknown Supabase client error" };
  }

  if (error) {
    console.error("[welcome-interest] Supabase insert failed", {
      email,
      feedback_preview: feedback.slice(0, 120),
      message: error.message,
      code: error.code,
    });
    return NextResponse.json({ ok: false, error: "storage_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, stored: true });
}
