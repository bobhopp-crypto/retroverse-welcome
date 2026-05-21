/** Intentional empty-cover treatment — archival sleeve, not a broken image. */
export function ArchivalCoverVoid({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`dossier-archival-void${compact ? " dossier-archival-void--compact" : ""}`}
      aria-hidden
    >
      <span className="dossier-archival-void-grain" />
      <span className="dossier-archival-void-sleeve" />
      <span className="dossier-archival-void-seal">
        <span className="dossier-archival-void-mark">RV</span>
      </span>
      <span className="dossier-archival-void-stamp">Archive</span>
      <span className="dossier-archival-void-caption">Sleeve unavailable</span>
    </span>
  );
}
