type AlbumMediaSignalsProps = {
  hasVideo?: boolean;
  hasAudio?: boolean;
  hasYoutube?: boolean;
  mediaCount?: number;
  trackFamilyCount?: number;
};

export function AlbumMediaSignals({
  hasVideo,
  hasAudio,
  hasYoutube,
  mediaCount = 0,
  trackFamilyCount = 0,
}: AlbumMediaSignalsProps) {
  const items: string[] = [];
  if (hasVideo) items.push("Video in archive");
  else if (hasAudio || mediaCount > 0) items.push("Media linked");
  if (hasYoutube) items.push("YouTube reference");
  if (trackFamilyCount > 0) items.push(`${trackFamilyCount} track families`);

  if (items.length === 0) return null;

  return (
    <ul className="dossier-media-signals" aria-label="Archive signals">
      {items.map((label) => (
        <li key={label}>{label}</li>
      ))}
    </ul>
  );
}
