"use client";

import { FormEvent, useState } from "react";

export function WelcomeInterestForm() {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatus("loading");

    try {
      const res = await fetch("/api/welcome-interest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), feedback: feedback.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        setStatus("error");
        setErrorMsg(
          data.error === "invalid_email"
            ? "Please add a valid email so we can reach you."
            : "Something went wrong. You can try again in a moment.",
        );
        return;
      }

      setStatus("done");
      setEmail("");
      setFeedback("");
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong. You can try again in a moment.");
    }
  }

  if (status === "done") {
    return (
      <p className="rounded-lg border border-[var(--card-border)] bg-[var(--surface-raised)] px-4 py-3 text-sm text-[var(--text-primary)] shadow-[var(--card-shadow)]">
        Thank you. We&apos;ll be in touch as Retroverse opens up.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="welcome-email" className="block text-sm font-medium text-[var(--text-primary)]">
          Email
        </label>
        <input
          id="welcome-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-[var(--input)] bg-[var(--card-bg)] px-3 py-2.5 text-base text-[var(--text-primary)] shadow-sm outline-none placeholder:text-[var(--text-secondary)]/70 focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="welcome-feedback" className="block text-sm font-medium text-[var(--text-primary)]">
          What would you want to explore in Retroverse?
        </label>
        <textarea
          id="welcome-feedback"
          name="feedback"
          rows={4}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="w-full resize-y rounded-md border border-[var(--input)] bg-[var(--card-bg)] px-3 py-2.5 text-base text-[var(--text-primary)] shadow-sm outline-none placeholder:text-[var(--text-secondary)]/70 focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)]"
          placeholder="A week, an artist, a feeling, a memory..."
        />
      </div>

      {errorMsg ? (
        <p className="text-sm text-[var(--accent-tertiary)]" role="alert">
          {errorMsg}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={status === "loading"}
        className="inline-flex w-full items-center justify-center rounded-md border border-[var(--card-border)] bg-[var(--accent-primary)] px-4 py-2.5 text-base font-medium text-[var(--text-on-accent)] transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto"
      >
        {status === "loading" ? "Sending..." : "Stay in the loop"}
      </button>
    </form>
  );
}
