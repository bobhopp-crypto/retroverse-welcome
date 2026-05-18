/** YouTube search for acquisition / preview. */
export function youtubeSearchUrl(artist: string, title: string): string {
  const q = `${artist} ${title}`.trim();
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/** Best-effort local file URL when a VDJ asset path is known. */
export function vdjFileUrl(filePath: string): string {
  if (filePath.startsWith("file://")) return filePath;
  const normalized = filePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
}

export function vdjSearchClipboardLine(artist: string, title: string): string {
  return `${artist} - ${title}`.trim();
}
