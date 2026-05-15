/**
 * Static corpus for `/album-retroscope` only — no Supabase / ranking aggregation at runtime.
 * Rows pair real Retroverse-style `albumId` + cover paths (see `docs/LEGACY_COVER_RECONCILIATION.md`)
 * with narrative `(year, rank)` grid coordinates for the prototype.
 */
export type AlbumRetroscopeSeedRow = {
  year: number;
  rank: number;
  albumId: string;
  title: string;
  artist: string;
  canonicalCoverPath: string;
};

/** Exactly 25 anchors: unique `(year, rank)` coordinates. */
export const ALBUM_RETROSCOPE_SEED: readonly AlbumRetroscopeSeedRow[] = [
  {
    year: 1965,
    rank: 1,
    albumId: "RVAL000059",
    title: "I Told You",
    artist: "Tory Lanez",
    canonicalCoverPath: "retroverse/covers/RVAL000059/tory_lanez_-_i_told_you.jpg",
  },
  {
    year: 1966,
    rank: 1,
    albumId: "RVAL000173",
    title: "I See You (Avatar Soundtrack)",
    artist: "Soundtrack Orchestra",
    canonicalCoverPath: "retroverse/covers/RVAL000173/soundtrack_orchestra_-_i_see_you_avatar_avatar_soundtrack.jpg",
  },
  {
    year: 1967,
    rank: 1,
    albumId: "RVAL000324",
    title: "Home to the Sea",
    artist: "The San Sebastian Strings",
    canonicalCoverPath: "retroverse/covers/RVAL000324/the_san_sebastian_strings_-_home_to_the_sea.jpg",
  },
  {
    year: 1968,
    rank: 1,
    albumId: "RVAL000392",
    title: "Ralph Tresvant",
    artist: "Ralph Tresvant",
    canonicalCoverPath: "retroverse/covers/RVAL000392/ralph_tresvant_-_ralph_tresvant.jpg",
  },
  {
    year: 1969,
    rank: 1,
    albumId: "RVAL000698",
    title: "Mingus",
    artist: "Joni Mitchell",
    canonicalCoverPath: "retroverse/covers/RVAL000698/joni_mitchell_-_mingus.jpg",
  },
  {
    year: 1970,
    rank: 1,
    albumId: "RVAL000763",
    title: "Just Tell Me That You Want Me: A Tribute to Fleetwood Mac",
    artist: "Various Artists",
    canonicalCoverPath:
      "retroverse/covers/RVAL000763/various_artists_-_just_tell_me_that_you_want_me_a_tribute_to_fleetwood_mac.jpg",
  },
  {
    year: 1971,
    rank: 1,
    albumId: "RVAL000804",
    title: "Fourth from the Last",
    artist: "The W's",
    canonicalCoverPath: "retroverse/covers/RVAL000804/the_ws_-_fourth_from_the_last.jpg",
  },
  {
    year: 1972,
    rank: 1,
    albumId: "RVAL000891",
    title: "Playlist: The Very Best of Meat Loaf",
    artist: "Meat Loaf",
    canonicalCoverPath: "retroverse/covers/RVAL000891/meat_loaf_-_playlist_the_very_best_of_meat_loaf.jpg",
  },
  {
    year: 1973,
    rank: 1,
    albumId: "RVAL000935",
    title: "Electric",
    artist: "The Cult",
    canonicalCoverPath: "retroverse/covers/RVAL000935/the_cult_-_electric.jpg",
  },
  {
    year: 1974,
    rank: 1,
    albumId: "RVAL001020",
    title: "Sincerely Yours",
    artist: "Robert Goulet",
    canonicalCoverPath: "retroverse/covers/RVAL001020/robert_goulet_-_sincerely_yours.jpg",
  },
  {
    year: 1975,
    rank: 1,
    albumId: "RVAL001039",
    title: "The Buzz",
    artist: "Various Artists",
    canonicalCoverPath: "retroverse/covers/RVAL001039/various_artists_-_the_buzz.jpg",
  },
  {
    year: 1976,
    rank: 1,
    albumId: "RVAL001199",
    title: "Evolution",
    artist: "The Hollies",
    canonicalCoverPath: "retroverse/covers/RVAL001199/the_hollies_-_evolution.jpg",
  },
  {
    year: 1977,
    rank: 1,
    albumId: "RVAL001279",
    title: "E.B.A.H.",
    artist: "Tech N9ne",
    canonicalCoverPath: "retroverse/covers/RVAL001279/tech_n9ne_-_ebah.jpg",
  },
  {
    year: 1978,
    rank: 1,
    albumId: "RVAL001341",
    title: "Fortune",
    artist: "Chris Brown",
    canonicalCoverPath: "retroverse/covers/RVAL001341/chris_brown_-_fortune.jpg",
  },
  {
    year: 1979,
    rank: 1,
    albumId: "RVAL001388",
    title: "Energy",
    artist: "The Pointer Sisters",
    canonicalCoverPath: "retroverse/covers/RVAL001388/the_pointer_sisters_-_energy.jpg",
  },
  {
    year: 1980,
    rank: 1,
    albumId: "RVAL001442",
    title: "Cover With the Stylistics",
    artist: "The Stylistics",
    canonicalCoverPath: "retroverse/covers/RVAL001442/the_stylistics_-_cover_with_the_stylistics.jpg",
  },
  {
    year: 1981,
    rank: 1,
    albumId: "RVAL001822",
    title: "Music for Little Hipsters",
    artist: "Various Artists",
    canonicalCoverPath: "retroverse/covers/RVAL001822/various_artists_-_music_for_little_hipsters.jpg",
  },
  {
    year: 1982,
    rank: 1,
    albumId: "RVAL001937",
    title: "The Airborne Toxic Event",
    artist: "The Airborne Toxic Event",
    canonicalCoverPath: "retroverse/covers/RVAL001937/the_airborne_toxic_event_-_the_airborne_toxic_event.jpg",
  },
  {
    year: 1983,
    rank: 1,
    albumId: "RVAL001996",
    title: "Classic",
    artist: "David Phelps",
    canonicalCoverPath: "retroverse/covers/RVAL001996/david_phelps_-_classic.jpg",
  },
  {
    year: 1984,
    rank: 1,
    albumId: "RVAL002015",
    title: "Rod Stewart",
    artist: "Rod Stewart",
    canonicalCoverPath: "retroverse/covers/RVAL002015/rod_stewart_-_rod_stewart.jpg",
  },
  {
    year: 1985,
    rank: 1,
    albumId: "RVAL002035",
    title: "Electrodynamics",
    artist: "Dick Hyman & His Orchestra",
    canonicalCoverPath: "retroverse/covers/RVAL002035/dick_hyman_his_orchestra_-_electrodynamics.jpg",
  },
  {
    year: 1986,
    rank: 1,
    albumId: "RVAL002119",
    title: "Yessongs",
    artist: "Yes",
    canonicalCoverPath: "retroverse/covers/RVAL002119/yes_-_yessongs.jpg",
  },
  {
    year: 1987,
    rank: 1,
    albumId: "RVAL002199",
    title: "Spark of Love",
    artist: "Lenny Williams",
    canonicalCoverPath: "retroverse/covers/RVAL002199/lenny_williams_-_spark_of_love.jpg",
  },
  {
    year: 1988,
    rank: 1,
    albumId: "RVAL002210",
    title: "In the Dark",
    artist: "Grateful Dead",
    canonicalCoverPath: "retroverse/covers/RVAL002210/grateful_dead_-_in_the_dark.jpg",
  },
  {
    year: 1989,
    rank: 1,
    albumId: "RVAL000003",
    title: "Canonical sample",
    artist: "Retroverse",
    canonicalCoverPath: "retroverse/covers/RVAL000003/cover.jpg",
  },
] as const;
