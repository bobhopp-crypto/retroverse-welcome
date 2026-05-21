"use client";

import "./retroverse-public.css";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { HomeSearchPayload } from "@/lib/home-search/types";
import { normalizeHomeSearchPayload } from "@/lib/home-search/normalize-client";

const PLACEHOLDER = "Thriller, 1984, Fleetwood Mac, Purple Rain, Eagles";
const DEBOUNCE_MS = 280;

const EXAMPLES = ["Thriller", "1984", "Fleetwood Mac", "Purple Rain", "Eagles"] as const;

const HOME_MODES = [
  {
    title: "Retroscope",
    href: "/album-retroscope",
    body: "Explore music history through time.",
  },
  {
    title: "Search",
    href: "/search",
    body: "Look up songs, albums, artists, and chart history.",
  },
  {
    title: "Eras",
    href: "/eras",
    body: "Explore Retroverse collections and musical eras.",
  },
] as const;

const HOME_PLACEHOLDERS = [
  { title: "Playlists", body: "Build and share lists from chart history." },
  { title: "Your library", body: "Connect a DJ library to chart titles." },
] as const;

const EMPTY: HomeSearchPayload = {
  ok: true,
  q: "",
  tracks: [],
  albums: [],
  artists: [],
  charts: [],
};

export default function AskRetroverseClient() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q")?.trim() ?? "";
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<HomeSearchPayload>(EMPTY);
  const [fetching, setFetching] = useState(false);
  const [searchIncomplete, setSearchIncomplete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const reqIdRef = useRef(0);

  const active = query.trim().length >= 2;
  const hasResults =
    results.tracks.length > 0 ||
    results.albums.length > 0 ||
    results.artists.length > 0 ||
    results.charts.length > 0;

  const fetchResults = useCallback(async (q: string, reqId: number) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setFetching(true);
    try {
      const res = await fetch(`/api/home-search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
      const raw = await res.json().catch(() => null);
      if (ac.signal.aborted || reqId !== reqIdRef.current) return;
      const body = normalizeHomeSearchPayload(raw, q);
      setResults(body);
      setSearchIncomplete(Boolean(body.incomplete) || !res.ok);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      if (reqId === reqIdRef.current) {
        setResults({ ...EMPTY, q });
        setSearchIncomplete(true);
      }
    } finally {
      if (!ac.signal.aborted && reqId === reqIdRef.current) setFetching(false);
    }
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(EMPTY);
      setSearchIncomplete(false);
      setFetching(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    const t = window.setTimeout(() => void fetchResults(q, reqId), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query, fetchResults]);

  return (
    <div className="rv-home rv-public-surface">
      <div className="rv-home-inner">
        <header className="rv-home-hero">
          <h1 className="rv-home-title">Retroverse</h1>
          <p className="rv-home-tagline">A music time machine.</p>
        </header>

        <div className="rv-home-search-wrap">
          <input
            type="search"
            className="rv-home-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDER}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            aria-label="Search Retroverse"
          />
          <p className="rv-home-hint">
            {fetching
              ? "Searching…"
              : searchIncomplete
                ? "Some results may be missing — try another spelling."
                : active
                  ? "Albums · tracks · artists"
                  : "Search songs, albums, artists, and years"}
          </p>
          {!active ? (
            <div className="rv-home-examples" aria-label="Example searches">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  className="rv-home-example"
                  onClick={() => setQuery(ex)}
                >
                  {ex}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {active ? (
          <div className="rv-home-results" aria-live="polite">
            {!hasResults && !fetching ? (
              <p className="rv-home-hint">No matches — try a song, album, or artist name.</p>
            ) : null}

            {results.albums.length > 0 ? (
              <section>
                <h2 className="rv-home-section-title">Albums</h2>
                {results.albums.map((a) => (
                  <Link key={a.href} href={a.href} className="rv-home-result">
                    <div className="rv-home-result-row">
                      <span className="rv-home-result-badge">{a.relation ?? "ALBUM"}</span>
                      <div className="rv-home-result-main">
                        {a.title} — {a.artist}
                      </div>
                    </div>
                    {a.year != null ? <div className="rv-home-result-sub">{a.year}</div> : null}
                  </Link>
                ))}
              </section>
            ) : null}

            {results.tracks.length > 0 ? (
              <section>
                <h2 className="rv-home-section-title">Tracks</h2>
                {results.tracks.map((t) => (
                  <Link key={`${t.href}|${t.title}`} href={t.href} className="rv-home-result">
                    <div className="rv-home-result-row">
                      <span className="rv-home-result-badge">{t.relation ?? "TRACK"}</span>
                      <div className="rv-home-result-main">
                        {t.title} — {t.artist}
                      </div>
                    </div>
                    {t.subtitle ? <div className="rv-home-result-sub">{t.subtitle}</div> : null}
                  </Link>
                ))}
              </section>
            ) : null}

            {results.artists.length > 0 ? (
              <section>
                <h2 className="rv-home-section-title">Artists</h2>
                {results.artists.map((a) => (
                  <Link key={a.href} href={a.href} className="rv-home-result">
                    <div className="rv-home-result-main">{a.name}</div>
                  </Link>
                ))}
              </section>
            ) : null}

            {results.charts.length > 0 ? (
              <section>
                <h2 className="rv-home-section-title">Chart weeks</h2>
                {results.charts.map((c) => (
                  <Link key={c.weekDate} href={c.href} className="rv-home-result">
                    <div className="rv-home-result-row">
                      <span className="rv-home-result-badge">{c.relation ?? "HOT100"}</span>
                      <div className="rv-home-result-main">{c.label}</div>
                    </div>
                  </Link>
                ))}
              </section>
            ) : null}
          </div>
        ) : (
          <nav className="rv-home-magazine" aria-label="Explore Retroverse">
            {HOME_MODES.map((section) => (
              <Link key={section.title} href={section.href} className="rv-home-card">
                <h2>{section.title}</h2>
                <p>{section.body}</p>
              </Link>
            ))}
            {HOME_PLACEHOLDERS.map((section) => (
              <div key={section.title} className="rv-home-card rv-home-card--muted">
                <h2>{section.title}</h2>
                <p>{section.body}</p>
              </div>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
