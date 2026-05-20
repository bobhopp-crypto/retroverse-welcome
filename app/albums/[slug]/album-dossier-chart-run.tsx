"use client";

import { useMemo, useState } from "react";

import type { AlbumChartRunWeek } from "@/lib/load-album-chart-run";

function formatArchiveDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return raw;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** #1 right, #200 left — archival position meter. */
function rankMeterX(position: number): string {
  const p = Math.max(1, Math.min(200, position));
  return `${((200 - p) / 199) * 100}%`;
}

function movementLabel(prev: number | null, curr: number): string | null {
  if (prev == null) return null;
  const delta = prev - curr;
  if (delta === 0) return "hold";
  if (delta > 0) return `▲${delta}`;
  return `▼${Math.abs(delta)}`;
}

type Props = {
  weeks: AlbumChartRunWeek[];
  fallbackFirst?: string | null;
  fallbackLast?: string | null;
};

export function AlbumDossierChartRun({ weeks, fallbackFirst, fallbackLast }: Props) {
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () => [...weeks].sort((a, b) => a.chart_date.localeCompare(b.chart_date)),
    [weeks],
  );

  const hasWeeks = sorted.length > 0;

  return (
    <div className="dossier-chart-run-module">
      <button
        type="button"
        className="dossier-chart-run-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Chart Run
      </button>

      {open ? (
        <div className="dossier-chart-run-panel" id="dossier-chart-run-panel">
          {!hasWeeks ? (
            <p className="dossier-chart-run-empty">
              {fallbackFirst
                ? `${formatArchiveDate(fallbackFirst)}${fallbackLast && fallbackLast !== fallbackFirst ? ` – ${formatArchiveDate(fallbackLast)}` : ""}`
                : "Chart week detail not loaded."}
            </p>
          ) : (
            <>
              <div className="dossier-trajectory-scale dossier-chart-run-scale" aria-hidden>
                <span>#200</span>
                <span>Billboard 200</span>
                <span>#1</span>
              </div>
              <ol className="dossier-trajectory-rail dossier-chart-run-weeks">
                {sorted.map((week, i) => {
                  const prev = i > 0 ? sorted[i - 1]!.chart_position : null;
                  const move = movementLabel(prev, week.chart_position);
                  const improved = prev != null && week.chart_position < prev;
                  const slipped = prev != null && week.chart_position > prev;
                  return (
                    <li
                      key={`${week.chart_date}-${week.chart_position}`}
                      className={`dossier-trajectory-week dossier-chart-run-week${i > 0 && week.chart_position === prev ? " dossier-trajectory-week--recurrence" : ""}`}
                    >
                      <div className="dossier-trajectory-date">
                        <span>{formatArchiveDate(week.chart_date)}</span>
                        {move && move !== "hold" ? (
                          <small className={improved ? "dossier-chart-run-move--up" : slipped ? "dossier-chart-run-move--down" : undefined}>
                            {move}
                          </small>
                        ) : move === "hold" ? <small>hold</small> : null}
                      </div>
                      <div className="dossier-trajectory-rank">
                        <strong>#{week.chart_position}</strong>
                      </div>
                      <div
                        className="dossier-trajectory-track dossier-chart-run-meter"
                        style={{ ["--rank-x" as string]: rankMeterX(week.chart_position) }}
                        aria-hidden
                      />
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
