"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

export default function OpsPinClient() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next") || "/ops/review";
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/internal/ops-auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!res.ok) {
        setErr("Bad PIN");
        setBusy(false);
        return;
      }
      router.replace(next.startsWith("/") ? next : "/ops/review");
      router.refresh();
    } catch {
      setErr("Request failed");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold tracking-tight">Retroverse ops</h1>
      <p className="text-sm text-neutral-600">Enter PIN to continue.</p>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          className="rounded border border-neutral-300 px-3 py-2 text-sm"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
        />
        {err ? <p className="text-sm text-red-600">{err}</p> : null}
        <button
          type="submit"
          disabled={busy || pin.length === 0}
          className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
