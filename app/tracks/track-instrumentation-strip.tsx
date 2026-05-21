import Image from "next/image";
import Link from "next/link";
import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { loadLegacyVideoCache } from "@/lib/legacy-playback/video-cache";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { resolveTrackPlayState } from "@/lib/track-media-state";
import { tryCreateClient } from "@/lib/supabase";

import { TrackMediaStateCluster } from "./track-media-state-cluster";
import { TrackSonicMeters } from "./track-sonic-meters";

export type TrackStripAlbumLink = {
  albumId: string;
  href: string;
  title: string;
};

type Props = {
  artist: string;
  title: string;
  profile: AggregatedAcousticProfile;
  retroverseTrackId?: string | null;
  albumLink?: TrackStripAlbumLink | null;
};

async function loadStripAlbumCover(albumId: string): Promise<string | null> {
  const supabase = tryCreateClient();
  if (!supabase) return null;
  const rows = await loadAlbumArtworkRows(supabase, [albumId]);
  const path = selectCanonicalArtwork(rows, albumId, null)?.canonical_cover_path ?? null;
  return canonicalCoverPathToUrl(path);
}

export async function TrackInstrumentationStrip({
  artist,
  title,
  profile,
  retroverseTrackId,
  albumLink,
}: Props) {
  void retroverseTrackId;
  const { cache } = await loadLegacyVideoCache();
  const play = resolveTrackPlayState(artist, title, cache);
  const coverUrl =
    albumLink?.albumId?.trim() ? await loadStripAlbumCover(albumLink.albumId) : null;

  return (
    <section className="dossier-track-instrument-strip" aria-label="Track instrumentation">
      <div className="dossier-track-instrument-zone dossier-track-instrument-zone--sonic">
        <TrackSonicMeters profile={profile} a11yLabel={`${title}. Sonic fingerprint.`} />
      </div>

      <div className="dossier-track-instrument-zone dossier-track-instrument-zone--center">
        <p className="dossier-track-instrument-etch">Track fingerprint</p>
        {albumLink ? (
          <Link href={albumLink.href} className="dossier-track-instrument-album">
            {coverUrl ? (
              <span className="dossier-track-instrument-album-cover" aria-hidden>
                <Image src={coverUrl} alt="" width={28} height={28} unoptimized />
              </span>
            ) : null}
            <span className="dossier-track-instrument-album-title">{albumLink.title}</span>
          </Link>
        ) : null}
      </div>

      <TrackMediaStateCluster
        state={play.state}
        title={title}
        mediaLabel={play.mediaLabel}
        playbackUrl={play.playbackUrl}
        artist={artist}
        videoCache={cache}
      />
    </section>
  );
}
