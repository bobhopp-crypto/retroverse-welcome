"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

function IconHelpBroadcast() {
  return (
    <svg className="dossier-operator-trigger-icon" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.25" opacity="0.55" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="0.85" opacity="0.35" strokeDasharray="3 2" />
      <path d="M12 7v1.5M12 16V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="12" cy="17.3" r="0.85" fill="currentColor" />
    </svg>
  );
}

function FigCoverFrame() {
  return (
    <svg className="dossier-operator-fig" viewBox="0 0 280 120" aria-hidden>
      <defs>
        <filter id="op-glow-c" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <marker id="op-ar" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="rgba(218,165,110,0.75)" />
        </marker>
      </defs>
      <rect x="12" y="18" width="86" height="86" rx="4" fill="rgba(45,32,28,0.6)" stroke="rgba(218,165,110,0.45)" strokeWidth="1.2" />
      <path d="M24 92 L48 62 L62 76 L82 52 L86 92 Z" fill="none" stroke="rgba(115,195,200,0.25)" strokeWidth="1" />
      <circle cx="58" cy="40" r="6" fill="none" stroke="rgba(232,170,110,0.3)" strokeWidth="1" />
      <path
        d="M108 58 L148 58"
        stroke="rgba(218,165,110,0.7)"
        strokeWidth="1.2"
        markerEnd="url(#op-ar)"
        filter="url(#op-glow-c)"
      />
      <rect x="156" y="28" width="112" height="64" rx="3" fill="rgba(18,14,22,0.45)" stroke="rgba(115,195,200,0.35)" strokeWidth="1" />
      <text x="162" y="48" fill="rgba(235,220,200,0.45)" fontSize="9" fontFamily="system-ui, sans-serif" letterSpacing="0.12em">
        CANONICAL COVER
      </text>
      <text x="162" y="66" fill="rgba(115,195,200,0.55)" fontSize="8" fontFamily="ui-monospace, monospace">
        VirtualDJ path → site
      </text>
    </svg>
  );
}

function FigArchivePanel() {
  return (
    <svg className="dossier-operator-fig" viewBox="0 0 280 132" aria-hidden>
      <rect x="14" y="22" width="252" height="88" rx="5" fill="rgba(26,22,28,0.55)" stroke="rgba(185,155,115,0.25)" strokeWidth="1" />
      <circle cx="36" cy="44" r="14" fill="none" stroke="rgba(115,195,200,0.45)" strokeWidth="1.2" strokeDasharray="4 3" />
      <path d="M52 44 H78" stroke="rgba(218,165,110,0.65)" strokeWidth="1.2" />
      <text x="86" y="48" fill="rgba(218,165,110,0.75)" fontSize="11" fontWeight="600" fontFamily="system-ui">
        Peak
      </text>
      <line x1="36" y1="78" x2="250" y2="78" stroke="rgba(255,235,215,0.06)" strokeWidth="1" />
      <rect x="48" y="86" width="72" height="16" rx="2" fill="rgba(218,155,95,0.12)" stroke="rgba(218,155,95,0.35)" strokeWidth="0.8" />
      <rect x="132" y="86" width="104" height="16" rx="2" fill="rgba(105,175,185,0.08)" stroke="rgba(105,175,185,0.3)" strokeWidth="0.8" />
      <path d="M26 118 Q140 104 268 118" stroke="rgba(115,195,200,0.2)" strokeWidth="1" fill="none" opacity="0.8" />
    </svg>
  );
}

function FigTrackStrip() {
  return (
    <svg className="dossier-operator-fig dossier-operator-fig--wide" viewBox="0 0 280 100" aria-hidden>
      <rect x="12" y="38" width="256" height="44" rx="4" fill="rgba(32,26,38,0.5)" stroke="rgba(195,155,95,0.2)" strokeWidth="1" />
      <circle cx="36" cy="60" r="14" stroke="rgba(115,195,200,0.4)" strokeWidth="1.1" fill="rgba(22,18,26,0.6)" />
      <path d="M32 56 L46 62 L32 64 Z" fill="rgba(218,165,110,0.35)" opacity="0.9" />
      <text x="60" y="56" fill="rgba(248,236,218,0.85)" fontSize="11" fontFamily="Georgia, serif" fontStyle="italic">
        Canonical sequence
      </text>
      <text x="60" y="72" fill="rgba(205,178,148,0.45)" fontSize="8" fontFamily="ui-monospace, monospace" letterSpacing="0.06em">
        SIDE · TITLE · LINKAGE
      </text>
      <rect x="188" y="48" width="36" height="24" rx="3" stroke="rgba(115,195,200,0.35)" strokeWidth="0.9" fill="rgba(95,165,172,0.08)" />
      <rect x="228" y="48" width="36" height="24" rx="3" stroke="rgba(218,155,95,0.35)" strokeWidth="0.9" fill="rgba(218,140,70,0.08)" />
      <path d="M12 26 L268 26" stroke="rgba(115,195,200,0.35)" strokeWidth="0.8" strokeDasharray="4 5" markerStart="url(#op-ar-left)" markerEnd="url(#op-ar2)" />
      <defs>
        <marker id="op-ar-left" markerWidth="6" markerHeight="6" refX="1" refY="3" orient="auto-start-reverse">
          <path d="M0,3 L6,1 L6,5 Z" fill="rgba(115,195,200,0.45)" />
        </marker>
        <marker id="op-ar2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="rgba(218,165,110,0.55)" />
        </marker>
      </defs>
    </svg>
  );
}

function FigSpatialGrid() {
  const cells: ReactNode[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const active = row === 1 && col === 1;
      cells.push(
        <rect
          key={`g-${row}-${col}`}
          x={38 + col * 62}
          y={22 + row * 26}
          width={54}
          height={20}
          rx={3}
          fill={active ? "rgba(218,155,95,0.18)" : "rgba(24,22,28,0.45)"}
          stroke={active ? "rgba(218,155,95,0.42)" : "rgba(115,195,200,0.14)"}
          strokeWidth={active ? 1.1 : 0.65}
        />,
      );
    }
  }
  return (
    <svg className="dossier-operator-fig" viewBox="0 0 280 126" aria-hidden>
      {cells}
      <path
        d="M194 72 L246 72"
        stroke="rgba(218,165,110,0.55)"
        strokeWidth={1.2}
        strokeDasharray="3 4"
      />
      <circle cx="256" cy="72" r="10" stroke="rgba(115,195,200,0.4)" strokeWidth="1" fill="rgba(115,195,200,0.06)" />
      <text x="40" y="116" fill="rgba(215,185,155,0.42)" fontSize="8" fontFamily="system-ui" letterSpacing="0.06em">
        Year · rank anchors · neighborhood
      </text>
    </svg>
  );
}

export function AlbumDossierOperatorOverlay() {
  const [open, setOpen] = useState(false);
  const dialogId = useId();
  const titleId = useId();
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => closeBtnRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className="dossier-operator-trigger"
        aria-expanded={open}
        aria-controls={dialogId}
        aria-label="Open Retroverse operator reference layer"
        onClick={() => setOpen(true)}
      >
        <IconHelpBroadcast />
      </button>

      {open ? (
        <div
          id={dialogId}
          className="dossier-operator-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <button type="button" className="dossier-operator-scrim" aria-label="Dismiss reference sheet" tabIndex={-1} onClick={close} />
          <div className="dossier-operator-glass-shell">
            <div className="dossier-operator-glass-phosphor" aria-hidden />
            <div className="dossier-operator-glass-contaminate" aria-hidden />
            <div className="dossier-operator-glass-grain" aria-hidden />

            <header className="dossier-operator-chrome">
              <div className="dossier-operator-chrome-titles">
                <p className="dossier-operator-eyebrow">Broadcast pamphlet · layer ON</p>
                <h2 id={titleId} className="dossier-operator-sheet-title">
                  Operator reference
                </h2>
                <p className="dossier-operator-sheet-sub">
                  Printed acetate projected over your dossier. Read the gauges, follow the veins.
                </p>
              </div>
              <button
                ref={closeBtnRef}
                type="button"
                className="dossier-operator-close"
                aria-label="Close reference sheet"
                onClick={close}
              >
                <span aria-hidden className="dossier-operator-close-x">
                  ×
                </span>
                <span className="dossier-operator-close-label">Close</span>
              </button>
            </header>

            <div className="dossier-operator-scroll">
              <section className="dossier-operator-section">
                <div className="dossier-operator-section-marker">
                  <span className="dossier-operator-callout-num">01</span>
                  <span className="dossier-operator-callout-chip">COVER PLATE</span>
                </div>
                <FigCoverFrame />
                <ul className="dossier-operator-bullets">
                  <li>
                    Tap the bezel — drift into{" "}
                    <strong className="dossier-operator-strong">RetroScope</strong>, where the spatial archive waits.
                  </li>
                  <li>Curator tools (artwork lineage) breathe through footer <em>Operator · artwork</em> — bookmark it.</li>
                  <li>The frame pulls from the canonical path: export truth lives in DJ tags; we only reflect it.</li>
                </ul>
              </section>

              <section className="dossier-operator-section">
                <div className="dossier-operator-section-marker">
                  <span className="dossier-operator-callout-num">02</span>
                  <span className="dossier-operator-callout-chip">ARCHIVE PRESENCE</span>
                </div>
                <FigArchivePanel />
                <ul className="dossier-operator-bullets">
                  <li>
                    <strong className="dossier-operator-strong">Peak</strong> remembers the tallest moment;{" "}
                    <strong className="dossier-operator-strong">Weeks charted</strong> stretches the storyline.
                  </li>
                  <li>
                    <strong className="dossier-operator-strong">First / Last</strong> are calendar stitches — anchors in Retroverse chronology.
                  </li>
                  <li className="dossier-operator-whisper">
                    Retroverse owes a poetic debt to <em>Billboard</em> heritage, yet our atlas sets its own meridians.
                  </li>
                </ul>
              </section>

              <section className="dossier-operator-section">
                <div className="dossier-operator-section-marker">
                  <span className="dossier-operator-callout-num">03</span>
                  <span className="dossier-operator-callout-chip">CANONICAL TRACKS</span>
                </div>
                <FigTrackStrip />
                <ul className="dossier-operator-bullets">
                  <li>
                    Rows carry only the <strong className="dossier-operator-strong">sequence marker</strong>, title, duration, and canonical reference.
                  </li>
                  <li>
                    Original side labels stay intact when the historical release identity provides them.
                  </li>
                  <li>
                    Bonus, alternate, expanded, and previously unreleased rows stay out of the main listening sequence.
                  </li>
                </ul>
              </section>

              <section className="dossier-operator-section">
                <div className="dossier-operator-section-marker">
                  <span className="dossier-operator-callout-num">04</span>
                  <span className="dossier-operator-callout-chip">GRID NEIGHBORHOOD</span>
                </div>
                <FigSpatialGrid />
                <ul className="dossier-operator-bullets">
                  <li>
                    <strong className="dossier-operator-strong">Discography —</strong> siblings under the same star, sorted by vintage and rank echoes.
                  </li>
                  <li>
                    <strong className="dossier-operator-strong">Adjacent on Retroverse grid —</strong> cells that brush your coordinate in era-space.
                  </li>
                  <li className="dossier-operator-whisper">
                    Think planetarium tiling, not shopping lists — you navigate constellations, not aisles.
                  </li>
                </ul>
              </section>

              <p className="dossier-operator-footnote">
                ESC / dim field / Close — veil lifts. Signals stay inscribed beneath.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
