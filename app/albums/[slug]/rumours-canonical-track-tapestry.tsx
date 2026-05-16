import type { PocAddState, PocPlayState, RumoursCanonicalTapestryRow } from "@/lib/rumours-proof-poc";

import { RetroverseAcousticInstrumentation } from "./retroverse-acoustic-instrumentation";

function playTooltip(s: PocPlayState): string {
  switch (s) {
    case "unavailable":
      return "Quiet for now.";
    case "external_available":
      return "Opens outside Retroverse.";
    case "local_verified":
      return "In your vault.";
    default:
      return "";
  }
}

function playCaption(s: PocPlayState): string {
  switch (s) {
    case "unavailable":
      return "Mute";
    case "external_available":
      return "Out";
    case "local_verified":
      return "Vault";
    default:
      return "";
  }
}

function addTooltip(s: PocAddState): string {
  switch (s) {
    case "not_added":
      return "Not saved yet.";
    case "wanted":
      return "On your wishlist.";
    case "added":
      return "In your crate.";
    default:
      return "";
  }
}

function addCaption(s: PocAddState): string {
  switch (s) {
    case "not_added":
      return "Add";
    case "wanted":
      return "Want";
    case "added":
      return "Held";
    default:
      return "";
  }
}

function addGlyph(s: PocAddState): string {
  switch (s) {
    case "not_added":
      return "+";
    case "wanted":
      return "★";
    case "added":
      return "✓";
    default:
      return "+";
  }
}

export function RumoursCanonicalTrackTapestry({ rows }: { rows: RumoursCanonicalTapestryRow[] }) {
  return (
    <section className="dossier-panel dossier-panel--tracks dossier-panel--band-plank dossier-panel--canon-tapestry">
      <h2 className="dossier-panel-label dossier-rumours-strip-heading">Tracks</h2>
      <div className="dossier-canon-stack dossier-canon-stack--strip">
        {rows.map((row, i) => (
          <article
            key={row.retroverse_track_id}
            className={`dossier-canon-lane dossier-canon-lane--strip dossier-canon-lane--${i % 2 === 0 ? "amber" : "teal"}`}
          >
            <div className="dossier-canon-lane-num" aria-hidden>
              {row.track_number}
            </div>
            <div className="dossier-canon-instrument">
              <RetroverseAcousticInstrumentation
                presentation="arcade"
                profile={row.profile}
                a11yLabel={row.display_title}
                domIdSlug={row.retroverse_track_id}
              />
            </div>
            <div className="dossier-canon-strip-cluster">
              <div className="dossier-canon-strip-mid">
                <h3 className="dossier-canon-strip-title">{row.display_title}</h3>
              </div>
              <div className="dossier-canon-lane-actions dossier-canon-lane-actions--strip">
                <button
                  type="button"
                  className={`dossier-tact dossier-tact--strip dossier-tact--play dossier-tact--play-${row.playState}`}
                  disabled
                  title={playTooltip(row.playState)}
                >
                  <span className="dossier-tact-glyph" aria-hidden>
                    ▶
                  </span>
                  <span className="dossier-tact-label dossier-tact-label--strip">{playCaption(row.playState)}</span>
                </button>
                <button
                  type="button"
                  className={`dossier-tact dossier-tact--strip dossier-tact--add dossier-tact--add-${row.addState}`}
                  disabled
                  title={addTooltip(row.addState)}
                >
                  <span className="dossier-tact-glyph" aria-hidden>
                    {addGlyph(row.addState)}
                  </span>
                  <span className="dossier-tact-label dossier-tact-label--strip">{addCaption(row.addState)}</span>
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
