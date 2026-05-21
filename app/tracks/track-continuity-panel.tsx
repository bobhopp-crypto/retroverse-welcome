import Link from "next/link";

import type { TrackAlbumLink, TrackContinuitySection } from "@/lib/track-continuity";

type Props = {
  albums: TrackAlbumLink[];
  sections: TrackContinuitySection[];
  albumsHeading?: string;
};

export function TrackContinuityPanel({
  albums,
  sections,
  albumsHeading = "Album continuity",
}: Props) {
  const hasAlbums = albums.length > 0;
  const hasContinuity = sections.some((section) => section.items.length > 0);
  if (!hasAlbums && !hasContinuity) return null;

  return (
    <section className="dossier-track-support">
      {hasAlbums ? (
        <article className="dossier-panel dossier-panel--band-plank">
          <h2 className="dossier-panel-label">{albumsHeading}</h2>
          <ul className="dossier-support-list">
            {albums.map((album) => (
              <li key={album.albumId}>
                <Link href={`/albums/${album.albumId}`}>{album.albumTitle}</Link>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      {sections.map((section) => (
        <article
          key={section.kind}
          className={`dossier-panel dossier-panel--band-gold dossier-track-continuity--${section.kind}`}
        >
          <h2 className="dossier-panel-label">{section.heading}</h2>
          <ul className="dossier-support-list">
            {section.items.map((item) => (
              <li key={item.href}>
                <Link href={item.href}>{item.title}</Link>
                <span>
                  {item.meta ? `${item.meta} · ` : ""}
                  {item.artist}
                </span>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </section>
  );
}
