import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";

function clamp01(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mean01(...vals: Array<number | null | undefined>): number {
  const ok = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (!ok.length) return 0;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/** Cultural presence — broadcast/liveness pulse from acoustic features (not chart data). */
function culturalPresenceMetric(profile: AggregatedAcousticProfile): number {
  return clamp01(mean01(profile.liveness, profile.speechiness, profile.danceability));
}

/** Replay pull — rhythmic + energy lift (not raw Spotify labels). */
function replayabilityMetric(profile: AggregatedAcousticProfile): number {
  return clamp01(mean01(profile.danceability, profile.energy, profile.valence != null ? profile.valence * 0.85 : null));
}

/** Strip “intensity” — live pulse + energy lift. */
function intensityMetric(profile: AggregatedAcousticProfile): number {
  return clamp01(mean01(profile.energy, profile.liveness, profile.loudness != null ? (profile.loudness + 60) / 60 : null));
}

function polar(cx: number, cy: number, r: number, angRad: number): { x: number; y: number } {
  return { x: cx + r * Math.cos(angRad), y: cy + r * Math.sin(angRad) };
}

/** Clockwise arc on SVG — metric m ∈ [0,1] fills one quadrant (90°) from startRad. */
function quadrantArc(
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  m: number,
): string {
  if (m <= 0) return "";
  const sweep = m * (Math.PI / 2);
  const a0 = startRad;
  const a1 = startRad + sweep;
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  const largeArc = sweep > Math.PI ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} 1 ${p1.x} ${p1.y}`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/** One-line cockpit readout (not a spreadsheet block). */
function telematicsLine(profile: AggregatedAcousticProfile): string | null {
  const parts: string[] = [];
  const d = formatDuration(profile.duration_ms);
  if (d !== "—") parts.push(d);
  if (profile.tempo != null && Number.isFinite(profile.tempo)) {
    parts.push(`${Math.round(profile.tempo)} BPM`);
  }
  if (profile.loudness != null && Number.isFinite(profile.loudness)) {
    parts.push(`${Math.round(profile.loudness)} DB`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Spotify acoustic ratios are 0–1 in dossier aggregates — expose as rounded percent everywhere user-facing. */
function fmtRatio01Pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
}

type Props = {
  profile: AggregatedAcousticProfile;
  /** Row label for screen readers (track title). */
  a11yLabel: string;
  /** Reserved for keyed gradients / defs when we add them back. */
  domIdSlug: string;
  /** Center Retroverse signal readout (0–99). */
  retroverseDial?: number;
  /** Track row: center reserved for play icon overlay (rings only). */
  hideCenterDial?: boolean;
  /** Track row experiment: lighter quadrant strokes. */
  simplifyRing?: boolean;
  /** Larger ring + type for the Rumours strip hero dial. */
  presentation?: "default" | "arcade" | "track-row" | "instrument-strip";
};

/**
 * Dossier-only acoustic “instrument” — segmented quadrant ring + center dial.
 * Visual vocabulary echoes `OperatorConsoleGlyph` in album-retroscope (concentric ring readout), not spreadsheet rows.
 */
export function RetroverseAcousticInstrumentation({
  profile,
  a11yLabel,
  domIdSlug,
  retroverseDial,
  hideCenterDial = false,
  simplifyRing = false,
  presentation = "default",
}: Props) {
  void domIdSlug;
  const arcade = presentation === "arcade";
  const trackRow = presentation === "track-row";
  const instrumentStrip = presentation === "instrument-strip";
  const telematics = trackRow || instrumentStrip ? null : telematicsLine(profile);
  const rs =
    retroverseDial != null && Number.isFinite(retroverseDial)
      ? Math.min(99, Math.max(0, Math.round(retroverseDial)))
      : Math.min(
          99,
          Math.round(
            mean01(
              profile.energy,
              profile.valence,
              culturalPresenceMetric(profile),
              replayabilityMetric(profile),
            ) * 100,
          ),
        );

  const cx = 50;
  const cy = 50;
  const rTrack = trackRow ? 39 : arcade ? 37 : 36;
  const rSignal = trackRow ? 32 : arcade ? 30.5 : 30;
  const wTrack = trackRow ? (simplifyRing ? 5.4 : 6) : arcade ? 6.35 : 5.5;
  const wSignal = trackRow ? (simplifyRing ? 4.8 : 5.4) : arcade ? 5.6 : 5;

  const quads = instrumentStrip
    ? [
        {
          m: clamp01(profile.energy),
          start: (-3 * Math.PI) / 4,
          track: "rgba(232,107,79,0.12)",
          signal: "rgba(232,107,79,0.82)",
          label: "E",
          title: `Energy ${fmtRatio01Pct(profile.energy)}`,
        },
        {
          m: clamp01(profile.danceability),
          start: -Math.PI / 4,
          track: "rgba(255,200,120,0.12)",
          signal: "rgba(255,200,120,0.8)",
          label: "D",
          title: `Danceability ${fmtRatio01Pct(profile.danceability)}`,
        },
        {
          m: clamp01(profile.valence),
          start: Math.PI / 4,
          track: "rgba(199,107,143,0.12)",
          signal: "rgba(199,107,143,0.82)",
          label: "M",
          title: `Mood ${fmtRatio01Pct(profile.valence)}`,
        },
        {
          m: intensityMetric(profile),
          start: (3 * Math.PI) / 4,
          track: "rgba(94,196,207,0.12)",
          signal: "rgba(94,196,207,0.8)",
          label: "I",
          title: `Intensity ${fmtRatio01Pct(intensityMetric(profile))}`,
        },
      ]
    : [
        {
          m: clamp01(profile.energy),
          start: (-3 * Math.PI) / 4,
          track: simplifyRing ? "rgba(232,107,79,0.1)" : "rgba(232,107,79,0.14)",
          signal: simplifyRing ? "rgba(232,107,79,0.78)" : "rgba(232,107,79,0.92)",
          label: "E",
          title: `Energy ${fmtRatio01Pct(profile.energy)}`,
        },
        {
          m: clamp01(profile.valence),
          start: -Math.PI / 4,
          track: simplifyRing ? "rgba(199,107,143,0.1)" : "rgba(199,107,143,0.14)",
          signal: simplifyRing ? "rgba(199,107,143,0.78)" : "rgba(199,107,143,0.92)",
          label: "Em",
          title: `Emotion ${fmtRatio01Pct(profile.valence)}`,
        },
        {
          m: culturalPresenceMetric(profile),
          start: Math.PI / 4,
          track: simplifyRing ? "rgba(94,196,207,0.1)" : "rgba(94,196,207,0.14)",
          signal: simplifyRing ? "rgba(94,196,207,0.78)" : "rgba(94,196,207,0.92)",
          label: "C",
          title: `Cultural presence ${fmtRatio01Pct(culturalPresenceMetric(profile))}`,
        },
        {
          m: replayabilityMetric(profile),
          start: (3 * Math.PI) / 4,
          track: simplifyRing ? "rgba(255,200,120,0.1)" : "rgba(255,200,120,0.14)",
          signal: simplifyRing ? "rgba(255,200,120,0.72)" : "rgba(255,200,120,0.88)",
          label: "R",
          title: `Replayability ${fmtRatio01Pct(replayabilityMetric(profile))}`,
        },
      ];

  const ariaCore = trackRow || instrumentStrip ? a11yLabel : `${a11yLabel}. Retroverse signal ${rs}.`;

  if (instrumentStrip) {
    const cx = 50;
    const cy = 50;
    const rTrack = 36;
    const rSignal = 30;
    const wTrack = 5.2;
    const wSignal = 4.6;
    return (
      <figure className="dossier-inst dossier-inst--instrument-strip">
        <svg className="dossier-inst-svg dossier-inst-svg--strip" viewBox="0 0 100 100" role="img" aria-label={ariaCore}>
          <circle cx={cx} cy={cy} r={rTrack + wTrack * 0.45} fill="none" stroke="rgba(255,247,240,0.06)" strokeWidth="1" />
          {quads.map((q, i) => (
            <path
              key={`t-${i}`}
              d={quadrantArc(cx, cy, rTrack, q.start, 1)}
              fill="none"
              stroke={q.track}
              strokeWidth={wTrack}
              strokeLinecap="round"
            />
          ))}
          {quads.map((q, i) =>
            q.m > 0 ? (
              <path
                key={`s-${i}`}
                d={quadrantArc(cx, cy, rSignal, q.start, q.m)}
                fill="none"
                stroke={q.signal}
                strokeWidth={wSignal}
                strokeLinecap="round"
              />
            ) : null,
          )}
        </svg>
        <figcaption className="dossier-inst-glyph dossier-inst-glyph--strip">
          {quads.map((q) => (
            <span key={q.label} style={{ color: q.signal }} title={q.title}>
              {q.label}
            </span>
          ))}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className={`dossier-inst${arcade ? " dossier-inst--arcade" : ""}${trackRow ? " dossier-inst--track-row" : ""}`}>
      <svg
        className="dossier-inst-svg"
        viewBox="0 0 100 100"
        role="img"
        aria-label={ariaCore}
      >
        <circle cx={cx} cy={cy} r={rTrack + wTrack * 0.45} fill="none" stroke="rgba(255,247,240,0.06)" strokeWidth="1" />
        {quads.map((q, i) => (
          <path
            key={`t-${i}`}
            d={quadrantArc(cx, cy, rTrack, q.start, 1)}
            fill="none"
            stroke={q.track}
            strokeWidth={wTrack}
            strokeLinecap="round"
          />
        ))}
        {quads.map((q, i) =>
          q.m > 0 ? (
            <path
              key={`s-${i}`}
              d={quadrantArc(cx, cy, rSignal, q.start, q.m)}
              fill="none"
              stroke={q.signal}
              strokeWidth={wSignal}
              strokeLinecap="round"
            />
          ) : null,
        )}
        {!hideCenterDial ? (
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill="rgba(245,235,224,0.96)"
            fontSize={trackRow ? 22 : arcade ? 32.3 : 25.65}
            fontWeight="700"
            fontFamily="ui-monospace, system-ui, monospace"
            letterSpacing="-0.05em"
          >
            {rs}
          </text>
        ) : null}
      </svg>
      {!trackRow ? (
        <figcaption className="dossier-inst-glyph">
          <span style={{ color: "rgba(232,107,79,0.85)" }} title={quads[0]!.title}>
            E
          </span>
          <span style={{ color: "rgba(199,107,143,0.85)" }} title={quads[1]!.title}>
            Em
          </span>
          <span style={{ color: "rgba(94,196,207,0.85)" }} title={quads[2]!.title}>
            C
          </span>
          <span style={{ color: "rgba(255,200,120,0.75)" }} title={quads[3]!.title}>
            R
          </span>
        </figcaption>
      ) : null}
      {telematics ? <p className="dossier-inst-telem">{telematics}</p> : null}
    </figure>
  );
}
