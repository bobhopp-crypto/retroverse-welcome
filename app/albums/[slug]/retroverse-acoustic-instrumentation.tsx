import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";

function clamp01(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Placeholder Retroverse dial readout until canonical RS exists in dossier JSON — mean of pooled 0–1 features. */
function retroverseDialReadout(profile: AggregatedAcousticProfile): number {
  const pts: number[] = [];
  for (const n of [
    profile.valence,
    profile.energy,
    profile.danceability,
    profile.acousticness != null ? 1 - profile.acousticness : null,
    profile.instrumentalness != null ? 1 - profile.instrumentalness : null,
    profile.liveness,
  ]) {
    if (n != null && Number.isFinite(n)) pts.push(n);
  }
  if (!pts.length) return 0;
  return Math.min(99, Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 100));
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
  /** Larger ring + type for the Rumours strip hero dial. */
  presentation?: "default" | "arcade";
};

/**
 * Dossier-only acoustic “instrument” — segmented quadrant ring + center dial.
 * Visual vocabulary echoes `OperatorConsoleGlyph` in album-retroscope (concentric ring readout), not spreadsheet rows.
 */
export function RetroverseAcousticInstrumentation({
  profile,
  a11yLabel,
  domIdSlug,
  presentation = "default",
}: Props) {
  void domIdSlug;
  const arcade = presentation === "arcade";
  const telematics = telematicsLine(profile);
  const rs = retroverseDialReadout(profile);

  const cx = 50;
  const cy = 50;
  const rTrack = arcade ? 37 : 36;
  const rSignal = arcade ? 30.5 : 30;
  const wTrack = arcade ? 6.35 : 5.5;
  const wSignal = arcade ? 5.6 : 5;

  const quads = [
    { m: clamp01(profile.valence), start: (-3 * Math.PI) / 4, track: "rgba(199,107,143,0.14)", signal: "rgba(199,107,143,0.92)" },
    { m: clamp01(profile.energy), start: -Math.PI / 4, track: "rgba(232,107,79,0.14)", signal: "rgba(232,107,79,0.92)" },
    { m: clamp01(profile.danceability), start: Math.PI / 4, track: "rgba(94,196,207,0.14)", signal: "rgba(94,196,207,0.92)" },
    { m: clamp01(profile.acousticness), start: (3 * Math.PI) / 4, track: "rgba(255,200,120,0.14)", signal: "rgba(255,200,120,0.88)" },
  ];

  const ariaCore = `${a11yLabel}. Retroverse signal ${rs}.`;

  return (
    <figure className={`dossier-inst${arcade ? " dossier-inst--arcade" : ""}`}>
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
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fill="rgba(245,235,224,0.96)"
          fontSize={arcade ? 32.3 : 25.65}
          fontWeight="700"
          fontFamily="ui-monospace, system-ui, monospace"
          letterSpacing="-0.05em"
        >
          {rs}
        </text>
      </svg>
      <figcaption className="dossier-inst-glyph">
        <span style={{ color: "rgba(199,107,143,0.85)" }} title={`Valence ${fmtRatio01Pct(profile.valence)}`}>
          V
        </span>
        <span style={{ color: "rgba(232,107,79,0.85)" }} title={`Energy ${fmtRatio01Pct(profile.energy)}`}>
          E
        </span>
        <span style={{ color: "rgba(94,196,207,0.85)" }} title={`Danceability ${fmtRatio01Pct(profile.danceability)}`}>
          D
        </span>
        <span style={{ color: "rgba(255,200,120,0.75)" }} title={`Acousticness ${fmtRatio01Pct(profile.acousticness)}`}>
          A
        </span>
      </figcaption>
      {telematics ? <p className="dossier-inst-telem">{telematics}</p> : null}
    </figure>
  );
}
