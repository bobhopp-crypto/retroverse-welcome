"use client";

import "./retroverse-landing.css";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HomeSearchPayload } from "@/lib/home-search/types";
import { normalizeHomeSearchPayload } from "@/lib/home-search/normalize-client";

const PLACEHOLDER = "Dreams · Fleetwood Mac · Rumours · Marvin Gaye · Billboard 1975";
const DEBOUNCE_MS = 280;

const EMPTY: HomeSearchPayload = {
  ok: true,
  q: "",
  tracks: [],
  albums: [],
  artists: [],
  charts: [],
};

const EDITORIAL = [
  {
    num: "01",
    tone: "magenta",
    title: "Search Any Song",
    body: "Type an artist, a song, an album, or a year. Retroverse pulls from chart memory — Billboard weeks, canonical albums, and the artists who shaped each era.",
    href: "/album-retroscope",
    cta: "Open Retroscope",
  },
  {
    num: "02",
    tone: "orange",
    title: "Travel Through Time",
    body: "Retroscope is a coordinate machine: swipe across years, climb ranks, reveal chart positions like squares on a living map. Each cell is a moment in Hot 100 history.",
    href: "/album-retroscope",
    cta: "Enter the grid",
  },
  {
    num: "03",
    tone: "gold",
    title: "Follow the Charts",
    body: "Track Deck replays the weekly parade — who was #1, who was climbing, what the culture sounded like that Friday. Chart memory, not a spreadsheet.",
    href: "/track-deck",
    cta: "Browse charts",
  },
  {
    num: "04",
    tone: "lime",
    title: "Build DJ Memory Trails",
    body: "Link your VirtualDJ library to chart titles. Match videos, save playable paths, and build trails from what you actually spin — your crate meets the canon.",
    href: "/relationship-workspace",
    cta: "Link workspace",
  },
  {
    num: "05",
    tone: "cyan",
    title: "Explore Albums Like Places",
    body: "Every album is a place you can visit — cover art, chart context, curator notes. Wander year to year like flipping through a record store wall that never ends.",
    href: "/portal-v2",
    cta: "Visit Portal",
  },
] as const;

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

  const magazineClass = useMemo(
    () => `rv-door-magazine${active && hasResults ? " rv-door-magazine--dim" : ""}`,
    [active, hasResults],
  );

  return (
    <div className="rv-door">
      <div className="rv-door-inner">
        <header className="rv-door-hero">
          <h1 className="rv-door-wordmark">Retroverse</h1>
          <p className="rv-door-kicker">Press Play for the Past</p>
          <p className="rv-door-promise">Search music history.</p>
        </header>

        <div className="rv-door-search-block">
          <input
            type="search"
            className="rv-door-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDER}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            aria-label="Search music history"
          />
          <p className="rv-door-hint">
            {fetching
              ? "tuning the dial…"
              : searchIncomplete
                ? "partial signal — try another spelling"
                : active
                  ? "tracks · albums · artists"
                  : "start typing — two letters opens the archive"}
          </p>
        </div>

        {active ? (
          <div className="rv-door-results">
            {!hasResults && !fetching ? (
              <p className="rv-door-hint">No matches on this frequency — try a song or album title.</p>
            ) : null}

            {results.tracks.length > 0 ? (
              <section>
                <div className="rv-door-section-head">Tracks</div>
                {results.tracks.map((t) => (
                  <Link key={`${t.href}|${t.title}`} href={t.href} className="rv-door-row">
                    <div className="rv-door-row-main">
                      {t.title} — {t.artist}
                    </div>
                    {t.subtitle ? <div className="rv-door-row-sub">{t.subtitle}</div> : null}
                  </Link>
                ))}
              </section>
            ) : null}

            {results.albums.length > 0 ? (
              <section>
                <div className="rv-door-section-head">Albums</div>
                {results.albums.map((a) => (
                  <Link key={a.href} href={a.href} className="rv-door-row">
                    <div className="rv-door-row-main">
                      {a.title} — {a.artist}
                    </div>
                    {a.year != null ? <div className="rv-door-row-sub">{a.year}</div> : null}
                  </Link>
                ))}
              </section>
            ) : null}

            {results.artists.length > 0 ? (
              <section>
                <div className="rv-door-section-head">Artists</div>
                {results.artists.map((a) => (
                  <Link key={a.href} href={a.href} className="rv-door-row">
                    <div className="rv-door-row-main">{a.name}</div>
                  </Link>
                ))}
              </section>
            ) : null}

            {results.charts.length > 0 ? (
              <section>
                <div className="rv-door-section-head">Chart weeks</div>
                {results.charts.map((c) => (
                  <Link key={c.weekDate} href={c.href} className="rv-door-row">
                    <div className="rv-door-row-main">{c.label}</div>
                  </Link>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}

        <div className={magazineClass} aria-label="Explore Retroverse">
            {EDITORIAL.map((story) => (
              <article
                key={story.num}
                className={`rv-door-story rv-door-story--${story.tone}`}
              >
                <span className="rv-door-story-num">{story.num}</span>
                <h2 className="rv-door-story-title">{story.title}</h2>
                <p className="rv-door-story-body">{story.body}</p>
                <Link href={story.href} className="rv-door-story-cta">
                  {story.cta}
                </Link>
              </article>
            ))}
        </div>

        <footer className="rv-door-footer">
          <Link href="/album-retroscope">Retroscope</Link>
          ·
          <Link href="/track-deck">Charts</Link>
          ·
          <Link href="/portal-v2">Portal</Link>
        </footer>
      </div>
    </div>
  );
}
