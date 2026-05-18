import { trackPlaybackKey } from "@/lib/legacy-playback/playback-key";

export function chartTrackLinkKey(artist: string, title: string): string {
  return trackPlaybackKey(artist, title);
}
