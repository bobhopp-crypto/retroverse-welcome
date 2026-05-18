export type HomeSearchTrack = {
  kind: "track";
  title: string;
  artist: string;
  href: string;
  subtitle: string | null;
};

export type HomeSearchAlbum = {
  kind: "album";
  title: string;
  artist: string;
  year: number | null;
  href: string;
};

export type HomeSearchArtist = {
  kind: "artist";
  name: string;
  href: string;
};

export type HomeSearchChart = {
  kind: "chart";
  label: string;
  year: number;
  weekDate: string;
  href: string;
};

export type HomeSearchPayload = {
  ok: true;
  q: string;
  tracks: HomeSearchTrack[];
  albums: HomeSearchAlbum[];
  artists: HomeSearchArtist[];
  charts: HomeSearchChart[];
  /** Set when corpus or Supabase was partial; UI may show a subtle hint. */
  incomplete?: boolean;
};
