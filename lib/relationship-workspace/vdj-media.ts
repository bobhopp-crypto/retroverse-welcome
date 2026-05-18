import path from "node:path";

export type VdjMediaKind = "video" | "audio" | "ignored";

export type VideoFormat = "mp4" | "mov" | "m4v" | "other-video";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".mkv", ".webm"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".aiff", ".aif", ".flac", ".m4a", ".aac", ".ogg", ".wma"]);

const IGNORE_PATH_PARTS = [
  /\/karaoke(?:\/|$)/i,
  /\/backups?(?:\/|$)/i,
  /\/stem(?:s)?(?:\/|$)/i,
  /\/scratch(?:\/|$)/i,
  /\/netsearch(?:\/|$)/i,
];

/** Paths that are never DJ video reconciliation targets. */
const AUDIO_ONLY_PATH_PARTS = [
  /\/mp3(?:\/|$)/i,
  /\/music(?:\/|$)/i,
  /\/audio(?:\/|$)/i,
  /\/itunes(?:\/|$)/i,
  /\/spotify(?:\/|$)/i,
];

export function normalizePathSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isDjVideoFolder(filePath: string): boolean {
  return /\/dj media\/video(?:\/|$)/i.test(normalizePathSlashes(filePath));
}

export function isVideoExtension(filePath: string): boolean {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

export function isAudioExtension(filePath: string): boolean {
  return AUDIO_EXTS.has(path.extname(filePath).toLowerCase());
}

export function videoFormatFromPath(filePath: string): VideoFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "mp4";
  if (ext === ".mov") return "mov";
  if (ext === ".m4v") return "m4v";
  if (VIDEO_EXTS.has(ext)) return "other-video";
  return null;
}

export function classifyVdjPath(filePath: string): VdjMediaKind {
  const lower = normalizePathSlashes(filePath).toLowerCase();

  if (IGNORE_PATH_PARTS.some((re) => re.test(lower))) return "ignored";

  if (isVideoExtension(filePath)) {
    if (AUDIO_ONLY_PATH_PARTS.some((re) => re.test(lower)) && !isDjVideoFolder(filePath)) {
      return "audio";
    }
    return "video";
  }

  if (isAudioExtension(filePath)) return "audio";

  if (AUDIO_ONLY_PATH_PARTS.some((re) => re.test(lower))) return "ignored";

  return "ignored";
}

/** Sort/search boost — never let MP3 outrank a VIDEO folder MP4. */
export function videoMatchBoost(filePath: string, kind: VdjMediaKind): number {
  if (kind !== "video") return -500;
  const lower = normalizePathSlashes(filePath).toLowerCase();
  if (/\/dj media\/video\/.*\.mp4$/i.test(lower)) return 90;
  if (/\/dj media\/video\/.*\.m4v$/i.test(lower)) return 80;
  if (/\/dj media\/video\/.*\.mov$/i.test(lower)) return 75;
  if (/\/dj media\/video\//i.test(lower)) return 65;
  if (/\.mp4$/i.test(lower)) return 45;
  if (/\.m4v$/i.test(lower)) return 40;
  if (/\.mov$/i.test(lower)) return 35;
  return 25;
}

export function isVideoStreamUrl(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes(".mp4") ||
    u.includes(".m4v") ||
    u.includes(".mov") ||
    u.includes("/video/") ||
    u.includes("/videos/")
  );
}

export function preferVideoUrl(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const curVideo = isVideoStreamUrl(current);
  const nextVideo = isVideoStreamUrl(candidate);
  if (nextVideo && !curVideo) return candidate;
  return current;
}
