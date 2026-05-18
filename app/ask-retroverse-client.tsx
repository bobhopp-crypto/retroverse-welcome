"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HomeSearchPayload } from "@/lib/home-search/types";
import { normalizeHomeSearchPayload } from "@/lib/home-search/normalize-client";

const MODULES = [
  { href: "/album-retroscope", label: "Retroscope", tag: "year × rank" },
  { href: "/track-deck", label: "Charts", tag: "track deck" },
  { href: "/relationship-workspace", label: "Link", tag: "video match" },
  { href: "/artists", label: "Artists", tag: "archive" },
  { href: "/albums", label: "Albums", tag: "archive" },
] as const;

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
    results.tracks.length > 0 || results.albums.length > 0 || results.artists.length > 0;

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

  const modulesClass = useMemo(
    () => `ask-modules${active && hasResults ? " ask-modules-dim" : ""}`,
    [active, hasResults],
  );

  return (
    <div className="ask-scope min-h-[calc(100vh-var(--rv-header-offset))] flex flex-col">
      <style>{`
        .ask-scope {
          --ask-bg: #15100a;
          --ask-surface: #1f1610;
          --ask-plate: #2a1d12;
          --ask-border: rgba(212, 162, 62, 0.2);
          --ask-muted: #a89068;
          --ask-fg: #f1e3c3;
          --ask-accent: #d4a23e;
          --ask-glow: rgba(212, 162, 62, 0.1);
          position: relative;
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          color: var(--ask-fg);
          background: var(--ask-bg);
          overflow: hidden;
        }
        .ask-scope::before {
          content: "";
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 50% at 50% -10%, var(--ask-glow), transparent 55%),
            repeating-linear-gradient(
              0deg,
              transparent,
              transparent 2px,
              rgba(0, 0, 0, 0.12) 2px,
              rgba(0, 0, 0, 0.12) 4px
            );
          pointer-events: none;
          opacity: 0.55;
        }
        .ask-scope::after {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 40%, transparent 40%, rgba(0, 0, 0, 0.45) 100%);
          pointer-events: none;
        }
        .ask-inner {
          position: relative;
          z-index: 1;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 1.5rem 1rem 2.5rem;
          max-width: 42rem;
          margin: 0 auto;
          width: 100%;
        }
        .ask-mark {
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          font-size: 0.72rem;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: var(--ask-muted);
          margin-bottom: 0.25rem;
        }
        .ask-title {
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          font-size: 1.35rem;
          font-weight: 500;
          color: var(--ask-accent);
          text-shadow: 0 0 24px rgba(212, 162, 62, 0.28);
          margin-bottom: 2rem;
        }
        .ask-search-wrap { width: 100%; margin-bottom: 1rem; }
        .ask-search {
          width: 100%;
          border: 1px solid var(--ask-border);
          border-bottom-width: 2px;
          background: rgba(21, 16, 10, 0.88);
          color: var(--ask-fg);
          font: inherit;
          font-size: 1.35rem;
          line-height: 1.3;
          padding: 0.85rem 1rem;
          outline: none;
        }
        .ask-search::placeholder { color: var(--ask-muted); opacity: 0.65; font-size: 0.95rem; }
        .ask-search:focus { border-color: rgba(212, 162, 62, 0.45); }
        .ask-hint { font-size: 0.65rem; letter-spacing: 0.08em; color: var(--ask-muted); min-height: 1rem; }
        .ask-results { width: 100%; margin-top: 0.5rem; }
        .ask-section { margin-bottom: 1rem; }
        .ask-section-head {
          font-size: 0.62rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--ask-muted);
          margin-bottom: 0.35rem;
          padding-bottom: 0.2rem;
          border-bottom: 1px solid var(--ask-border);
        }
        .ask-row {
          display: block;
          width: 100%;
          text-align: left;
          border: 1px solid transparent;
          border-bottom-color: rgba(212, 162, 62, 0.08);
          background: transparent;
          color: inherit;
          font: inherit;
          padding: 0.45rem 0.35rem;
          cursor: pointer;
          text-decoration: none;
        }
        .ask-row:hover { background: rgba(212, 162, 62, 0.06); border-color: var(--ask-border); }
        .ask-row-main { font-size: 0.82rem; color: var(--ask-fg); }
        .ask-row-sub { font-size: 0.68rem; color: var(--ask-muted); margin-top: 0.15rem; }
        .ask-modules {
          width: 100%;
          margin-top: auto;
          padding-top: 1.5rem;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
          gap: 0.45rem;
          transition: opacity 0.3s ease, filter 0.3s ease;
        }
        .ask-modules-dim { opacity: 0.38; filter: saturate(0.7); pointer-events: none; }
        .ask-plate {
          display: block;
          border: 1px solid var(--ask-border);
          background: var(--ask-plate);
          padding: 0.55rem 0.5rem;
          text-decoration: none;
          color: inherit;
        }
        .ask-plate-label { font-size: 0.72rem; color: var(--ask-accent); }
        .ask-plate-tag { font-size: 0.58rem; color: var(--ask-muted); margin-top: 0.2rem; }
      `}</style>

      <div className="ask-inner">
        <p className="ask-mark">Retroverse</p>
        <h1 className="ask-title">Ask Retroverse</h1>

        <div className="ask-search-wrap">
          <input
            type="search"
            className="ask-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDER}
            autoComplete="off"
            autoFocus
            spellCheck={false}
            aria-label="Ask Retroverse"
          />
          <p className="ask-hint mt-2">
            {fetching ? "searching…" : searchIncomplete ? "search incomplete — partial matches" : active ? "canonical matches" : "tracks · albums · artists"}
          </p>
        </div>

        {active ? (
          <div className="ask-results">
            {!hasResults && !fetching ? (
              <p className="ask-hint">No matches — try a song or album title.</p>
            ) : null}

            {results.tracks.length > 0 ? (
              <section className="ask-section">
                <div className="ask-section-head">Tracks</div>
                {results.tracks.map((t) => (
                  <Link key={`${t.href}|${t.title}`} href={t.href} className="ask-row">
                    <div className="ask-row-main">
                      {t.title} — {t.artist}
                    </div>
                    {t.subtitle ? <div className="ask-row-sub">{t.subtitle}</div> : null}
                  </Link>
                ))}
              </section>
            ) : null}

            {results.albums.length > 0 ? (
              <section className="ask-section">
                <div className="ask-section-head">Albums</div>
                {results.albums.map((a) => (
                  <Link key={a.href} href={a.href} className="ask-row">
                    <div className="ask-row-main">
                      {a.title} — {a.artist}
                    </div>
                    {a.year != null ? <div className="ask-row-sub">{a.year}</div> : null}
                  </Link>
                ))}
              </section>
            ) : null}

            {results.artists.length > 0 ? (
              <section className="ask-section">
                <div className="ask-section-head">Artists</div>
                {results.artists.map((a) => (
                  <Link key={a.href} href={a.href} className="ask-row">
                    <div className="ask-row-main">{a.name}</div>
                  </Link>
                ))}
              </section>
            ) : null}

            {results.charts.length > 0 ? (
              <section className="ask-section">
                <div className="ask-section-head">Chart weeks</div>
                {results.charts.map((c) => (
                  <Link key={c.weekDate} href={c.href} className="ask-row">
                    <div className="ask-row-main">{c.label}</div>
                  </Link>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}

        <nav className={modulesClass} aria-label="Retroverse modules">
          {MODULES.map((m) => (
            <Link key={m.href} href={m.href} className="ask-plate">
              <div className="ask-plate-label">{m.label}</div>
              <div className="ask-plate-tag">{m.tag}</div>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
