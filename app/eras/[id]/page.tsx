import type { Metadata } from "next";
import Link from "next/link";

interface EraPageProps {
  params: Promise<{
    id: string;
  }>;
}

const erasData: Record<
  string,
  {
    title: string;
    years: string;
    accentColor: string;
    summary: string;
    culturalThemes: string[];
    definingArtists: string[];
    definingAlbums: string[];
    definingSongs: string[];
    mediaShifts: string[];
  }
> = {
  "1950s-early": {
    title: "Early Rock & Roll",
    years: "1950-1953",
    accentColor: "#8B4513",
    summary:
      "The birth of rock and roll. When electric guitars first shook the world and radio changed forever. Bill Haley, Chuck Berry, and Little Richard started a revolution that would define a generation.",
    culturalThemes: [
      "Youth rebellion",
      "Electric energy",
      "Radio dominance",
      "Dance culture",
      "Post-war boom",
    ],
    definingArtists: [
      "Bill Haley & His Comets",
      "Chuck Berry",
      "Little Richard",
      "Fats Domino",
      "Ike Turner",
    ],
    definingAlbums: [
      '"Rock Around the Clock" - Bill Haley',
      '"The Essential Chuck Berry" (recordings from this era)',
      '"Here\'s Little Richard" - Little Richard',
      '"Rhythm & Blues" - Fats Domino',
    ],
    definingSongs: [
      '"Rock Around the Clock" - Bill Haley',
      '"Johnny B. Goode" - Chuck Berry',
      '"Tutti Frutti" - Little Richard',
      '"Blueberry Hill" - Fats Domino',
      '"Rocket 88" - Jackie Brenston',
    ],
    mediaShifts: [
      "Radio-based discovery",
      "Vinyl 45s and LPs",
      "Live performances crucial",
      "Television appearing",
      "Jukebox culture peak",
    ],
  },
  "1950s-late": {
    title: "The Golden Age",
    years: "1954-1957",
    accentColor: "#6F4E37",
    summary:
      "Elvis, Buddy Holly, and the consolidation of rock. The king arrived, changed music forever, and music became youth culture. This era defined the template for rock stardom.",
    culturalThemes: [
      "The King rises",
      "Teen culture",
      "Radio revolution",
      "Dance and sexuality",
      "Star system forms",
    ],
    definingArtists: [
      "Elvis Presley",
      "Buddy Holly",
      "Eddie Cochran",
      "Gene Vincent",
      "The Everly Brothers",
    ],
    definingAlbums: [
      '"Elvis Presley" - Elvis Presley',
      '"Elvis" (Album) - Elvis Presley',
      '"For Collectors of Early British Rock" - Buddy Holly',
    ],
    definingSongs: [
      '"Hound Dog" - Elvis Presley',
      '"That\'s All Right" - Elvis Presley',
      '"Peggy Sue" - Buddy Holly',
      '"Be-Bop-A-Lula" - Gene Vincent',
      '"Wake Up Little Susie" - The Everly Brothers',
    ],
    mediaShifts: [
      "Television performances",
      "Screen culture",
      "Fan magazines boom",
      "Live concerts return",
      "Recording technology advances",
    ],
  },
  "1960s-early": {
    title: "The British Invasion",
    years: "1958-1961",
    accentColor: "#8B5A3C",
    summary:
      "Folk and soul rising. The sixties began before the calendar said they did. American music was being reinvented by its own singers.",
    culturalThemes: [
      "Folk revival",
      "Soul emergence",
      "Political consciousness",
      "Authenticity valued",
      "Singer-songwriter era begins",
    ],
    definingArtists: [
      "Bob Dylan",
      "Sam Cooke",
      "Folk singers",
      "Early soul pioneers",
      "Ray Charles",
    ],
    definingAlbums: [
      '"Bob Dylan" - Bob Dylan',
      '"The Freewheelin\' Bob Dylan" - Bob Dylan',
      '"Live at the Regal" - Ray Charles',
    ],
    definingSongs: [
      '"Blowin\' in the Wind" - Bob Dylan',
      '"A Change Is Gonna Come" - Sam Cooke',
      '"Georgia on My Mind" - Ray Charles',
      '"House of the Rising Sun" - Various artists',
    ],
    mediaShifts: [
      "FM radio growing",
      "Album concept emerging",
      "Live folk clubs",
      "Recording studios expanding",
      "Singles still dominant",
    ],
  },
  "1960s-middle": {
    title: "The Transformative Sixties",
    years: "1962-1965",
    accentColor: "#7A6B3C",
    summary:
      "The Beatles, Dylan, and Motown. Music became art. Everything changed. This era saw pop and art merge, creating classics that still define popular music.",
    culturalThemes: [
      "British sound",
      "Motown magic",
      "Art and pop merge",
      "Studio experimentation",
      "Global phenomenon",
    ],
    definingArtists: [
      "The Beatles",
      "Bob Dylan",
      "The Rolling Stones",
      "Motown artists",
      "The Beach Boys",
    ],
    definingAlbums: [
      '"A Hard Day\'s Night" - The Beatles',
      '"Rubber Soul" - The Beatles',
      '"Highway 61 Revisited" - Bob Dylan',
      '"Pet Sounds" - The Beach Boys',
      '"What\'s Going On" - Marvin Gaye (later)',
    ],
    definingSongs: [
      '"A Hard Day\'s Night" - The Beatles',
      '"Like a Rolling Stone" - Bob Dylan',
      '"I Want to Hold Your Hand" - The Beatles',
      '"You Really Got Me" - The Kinks',
      '"Respect" - Aretha Franklin',
    ],
    mediaShifts: [
      "TV music shows",
      "Album focus growing",
      "Studio as instrument",
      "International stardom",
      "Fan culture reaches fever pitch",
    ],
  },
  "1960s-late": {
    title: "Psychedelia & Soul",
    years: "1966-1969",
    accentColor: "#8B7355",
    summary:
      "Woodstock, psychedelia, and the height of soul. Culture exploded in sound. This era pushed every boundary—musical, social, and creative. The album became the primary artistic statement.",
    culturalThemes: [
      "Psychedelia",
      "Soul movement",
      "Counter-culture",
      "Festival culture",
      "Studio artistry",
      "Political music",
    ],
    definingArtists: [
      "The Beatles",
      "Jimi Hendrix",
      "The Doors",
      "Aretha Franklin",
      "Led Zeppelin",
    ],
    definingAlbums: [
      '"Sgt. Pepper\'s Lonely Hearts Club Band" - The Beatles',
      '"Are You Experienced" - Jimi Hendrix',
      '"Axis: Bold as Love" - Jimi Hendrix',
      '"Led Zeppelin IV" - Led Zeppelin',
      '"I Never Loved a Man" - Aretha Franklin',
    ],
    definingSongs: [
      '"All You Need Is Love" - The Beatles',
      '"Purple Haze" - Jimi Hendrix',
      '"Light My Fire" - The Doors',
      '"Respect" - Aretha Franklin',
      '"Whole Lotta Love" - Led Zeppelin',
    ],
    mediaShifts: [
      "Album art importance",
      "Concert culture peak",
      "FM radio dominance",
      "Music festivals define era",
      "Recording technology leaps",
      "Rock opera emerges",
    ],
  },
  "1970s-early": {
    title: "Glam & Prog",
    years: "1970-1973",
    accentColor: "#6B5D54",
    summary:
      "David Bowie, Led Zeppelin, and progressive rock took over. Visual presentation became as important as sound. Albums became artistic statements longer than traditional songs.",
    culturalThemes: [
      "Glam rock",
      "Progressive rock",
      "Visual spectacle",
      "Album concept",
      "Theatrical presentation",
      "Virtuosity valued",
    ],
    definingArtists: [
      "David Bowie",
      "Led Zeppelin",
      "Pink Floyd",
      "Yes",
      "Elton John",
    ],
    definingAlbums: [
      '"The Man Who Sold the World" - David Bowie',
      '"Ziggy Stardust and the Spiders from Mars" - David Bowie',
      '"The Dark Side of the Moon" - Pink Floyd',
      '"Close to the Edge" - Yes',
      '"Goodbye Yellow Brick Road" - Elton John',
    ],
    definingSongs: [
      '"Space Oddity" - David Bowie',
      '"Changes" - David Bowie',
      '"Stairway to Heaven" - Led Zeppelin',
      '"Money" - Pink Floyd',
      '"Bohemian Rhapsody" - Queen',
    ],
    mediaShifts: [
      "Album-oriented radio",
      "Concert as theater",
      "Music videos early forms",
      "Record sleeve art",
      "Concept albums rule",
    ],
  },
  "1970s-late": {
    title: "Disco & Punk",
    years: "1974-1977",
    accentColor: "#7B6D62",
    summary:
      "Disco ruled the clubs. Punk ruled the streets. The decade split in two. Dance music reached new heights while a raw, stripped-down reaction emerged in the clubs and garages.",
    culturalThemes: [
      "Disco fever",
      "Punk rebellion",
      "Dance culture",
      "DIY ethos",
      "Two musical worlds",
      "Club vs. concert",
    ],
    definingArtists: [
      "Donna Summer",
      "The Sex Pistols",
      "Ramones",
      "The Bee Gees",
      "David Bowie",
    ],
    definingAlbums: [
      '"Saturday Night Fever" - Bee Gees',
      '"Rumours" - Fleetwood Mac',
      '"Parallel Lines" - Blondie',
      '"Never Mind the Bollocks" - Sex Pistols',
      '"Horses" - Patti Smith',
    ],
    definingSongs: [
      '"I Will Survive" - Gloria Gaynor',
      '"Blitzkrieg Bop" - Ramones',
      '"God Save the Queen" - Sex Pistols',
      '"Stayin\' Alive" - Bee Gees',
      '"Dancing Queen" - ABBA',
    ],
    mediaShifts: [
      "Club culture expansion",
      "Punk fanzines",
      "Studio 54 influence",
      "DIY recording",
      "Radio formats diverge",
    ],
  },
  "1980s-early": {
    title: "New Wave & Synth",
    years: "1978-1981",
    accentColor: "#8B7D6B",
    summary:
      "MTV arrived. Synthesizers became rock. Electronic sounds took over. The visual element became essential—you needed to look the part and fit the format.",
    culturalThemes: [
      "Electronic music",
      "Visual presentation",
      "New wave sophistication",
      "MTV generation",
      "Synth-pop",
      "Cool detachment",
    ],
    definingArtists: [
      "David Bowie",
      "Depeche Mode",
      "Duran Duran",
      "Blondie",
      "Joy Division",
    ],
    definingAlbums: [
      '"Scary Monsters" - David Bowie',
      '"Violator" - Depeche Mode',
      '"Rio" - Duran Duran',
      '"Plastic Letters" - Blondie',
      '"Unknown Pleasures" - Joy Division',
    ],
    definingSongs: [
      '"Ashes to Ashes" - David Bowie',
      '"Just Like Heaven" - The Cure',
      '"Hungry Like the Wolf" - Duran Duran',
      '"Personal Jesus" - Depeche Mode',
      '"Love Will Tear Us Apart" - Joy Division',
    ],
    mediaShifts: [
      "MTV launches 1981",
      "Music video essential",
      "Synth technology",
      "Studio as instrument",
      "Visual aesthetics crucial",
      "Fashion and music merge",
    ],
  },
  "1980s-middle": {
    title: "The MTV Era",
    years: "1982-1985",
    accentColor: "#6B5B4B",
    summary:
      "Michael Jackson, Prince, and the visual revolution. Sound became image. Pop was dominant, and success meant creating iconic videos and visual presence alongside the music.",
    culturalThemes: [
      "Pop dominance",
      "Music videos",
      "Visual spectacle",
      "African-American pop peak",
      "Genre-blending",
      "Production value",
    ],
    definingArtists: [
      "Michael Jackson",
      "Prince",
      "Madonna",
      "Cyndi Lauper",
      "George Michael",
    ],
    definingAlbums: [
      '"Thriller" - Michael Jackson',
      '"Purple Rain" - Prince',
      '"Like a Virgin" - Madonna',
      '"Sports" - Huey Lewis and the News',
      '"Come On Eileen" - Dexys Midnight Runners',
    ],
    definingSongs: [
      '"Billie Jean" - Michael Jackson',
      '"Like a Virgin" - Madonna',
      '"When Doves Cry" - Prince',
      '"Girls Just Want to Have Fun" - Cyndi Lauper',
      '"Wake Me Up Before You Go-Go" - Wham!',
    ],
    mediaShifts: [
      "MTV Peak influence",
      "Music videos as art",
      "MTV Unplugged concept",
      "Album-length videos",
      "Music and fashion fusion",
      "Radio formatted playlists",
    ],
  },
  "1980s-late": {
    title: "Hip-Hop Emerges",
    years: "1986-1989",
    accentColor: "#7B6B5B",
    summary:
      "Hip-hop left the Bronx. It was going global, and nothing was the same. Rap went mainstream, samples became the currency of cool, and a new generation took over the charts.",
    culturalThemes: [
      "Hip-hop mainstream",
      "Sampling culture",
      "Rap dominance",
      "Sampling as art",
      "Street culture",
      "Production innovation",
    ],
    definingArtists: [
      "Run-D.M.C.",
      "Public Enemy",
      "N.W.A",
      "Rakim",
      "LL Cool J",
    ],
    definingAlbums: [
      '"Licensed to Ill" - Beastie Boys',
      '"Raising Hell" - Run-D.M.C.',
      '"It Takes a Nation of Millions" - Public Enemy',
      '"Straight Outta Compton" - N.W.A',
      '"Follow the Leader" - Eric B. & Rakim',
    ],
    definingSongs: [
      '"Walk This Way" - Run-D.M.C. ft. Aerosmith',
      '"Fight the Power" - Public Enemy',
      '"Straight Outta Compton" - N.W.A',
      '"My Mic Sounds Nice" - Rakim',
      '"Don\'t Believe the Hype" - Public Enemy',
    ],
    mediaShifts: [
      "Rap radio formats",
      "DJ culture",
      "Sampling technology",
      "Music video innovation",
      "Street culture documentation",
      "Cross-genre collaboration",
    ],
  },
  "1990s-early": {
    title: "Grunge & Gangsta",
    years: "1990-1993",
    accentColor: "#8B7B6B",
    summary:
      "Seattle changed everything. Rap became mainstream. Nirvana took over. Rock was reborn as raw and authentic, while hip-hop became the dominant commercial force.",
    culturalThemes: [
      "Grunge authenticity",
      "Gangsta rap",
      "Anti-fashion fashion",
      "Rock revival",
      "Mainstream underground",
      "Alternative peak",
    ],
    definingArtists: [
      "Nirvana",
      "Dr. Dre",
      "Tupac",
      "Pearl Jam",
      "Soundgarden",
    ],
    definingAlbums: [
      '"Nevermind" - Nirvana',
      '"The Chronic" - Dr. Dre',
      '"All Eyez on Me" - Tupac',
      '"Voodoo Lounge" - The Rolling Stones',
      '"Dirt" - Alice in Chains',
    ],
    definingSongs: [
      '"Smells Like Teen Spirit" - Nirvana',
      '"Nothing Compares 2 U" - Sinéad O\'Connor',
      '"Nuthin\' but a \'G\' Thang" - Dr. Dre & Snoop Dogg',
      '"Black Hole Sun" - Soundgarden',
      '"Jeremy" - Pearl Jam',
    ],
    mediaShifts: [
      "MTV Unplugged",
      "Alternative radio",
      "Flannel aesthetic",
      "Hip-hop production",
      "CD dominance",
      "Festival culture returns",
    ],
  },
  "1990s-late": {
    title: "The Alt-Rock Peak",
    years: "1994-1997",
    accentColor: "#7B6B5B",
    summary:
      "Britpop, nu-metal, and the internet age. Rock one last time. The alternative became mainstream, Britpop divided the UK, and the internet was beginning to change everything.",
    culturalThemes: [
      "Britpop vs. Grunge",
      "Nineties cool",
      "Alternative mainstream",
      "Brit-culture peak",
      "Internet emergence",
      "Genre blending",
    ],
    definingArtists: [
      "Oasis",
      "Blur",
      "The Verve",
      "Radiohead",
      "Pulp",
    ],
    definingAlbums: [
      '"Definitely Maybe" - Oasis',
      '"Parklife" - Blur',
      '\"(What\'s the Story) Morning Glory?\" - Oasis',
      '"OK Computer" - Radiohead',
      '"A Northern Soul" - The Verve',
    ],
    definingSongs: [
      '"Wonderwall" - Oasis',
      '"Parklife" - Blur',
      '"Song 2" - Blur',
      '"Bitter Sweet Symphony" - The Verve',
      '"Fake Plastic Trees" - Radiohead',
    ],
    mediaShifts: [
      "Internet music discovery",
      "Napster era",
      "CD peak sales",
      "MTV still relevant",
      "Alternative charts",
      "Touring circuit dominance",
    ],
  },
  "2000s-early": {
    title: "The Digital Turn",
    years: "1998-2001",
    accentColor: "#8B6B4B",
    summary:
      "Y2K, Napster, and the end of the album era begins. Digital music and file-sharing disrupted the industry. Pop music shifted into new teen idol territory while rock fragmented.",
    culturalThemes: [
      "Napster disruption",
      "Digital music",
      "Teen pop",
      "Y2K aesthetics",
      "Industry change",
      "File-sharing wars",
    ],
    definingArtists: [
      "Britney Spears",
      "*NSYNC",
      "Eminem",
      "Radiohead",
      "The Strokes",
    ],
    definingAlbums: [
      '"...Baby One More Time" - Britney Spears',
      '"The Marshall Mathers LP" - Eminem',
      '"Kid A" - Radiohead',
      '"Is This It" - The Strokes',
      '"All That You Can\'t Leave Behind" - U2',
    ],
    definingSongs: [
      '"...Baby One More Time" - Britney Spears',
      '"Bye Bye Bye" - *NSYNC',
      '"Stan" - Eminem',
      '"The Scientist" - Coldplay',
      '"Wonderwall" - Oasis',
    ],
    mediaShifts: [
      "Napster launches",
      "File-sharing begins",
      "CD sales peak then drop",
      "MP3 format",
      "iTunes emerging",
      "YouTube not yet",
    ],
  },
  "2000s-late": {
    title: "Streaming Revolution",
    years: "2002-2005",
    accentColor: "#6B5B4B",
    summary:
      "iTunes changed music. Digital became real. Albums started to fade. The single became economics again as downloads made pricing per-track possible.",
    culturalThemes: [
      "iTunes revolution",
      "Single economy returns",
      "Digital dominance",
      "Indie rock peak",
      "Pop dissidents",
      "MySpace culture",
    ],
    definingArtists: [
      "The White Stripes",
      "Kanye West",
      "Amy Winehouse",
      "Beyoncé",
      "Arctic Monkeys",
    ],
    definingAlbums: [
      '"The College Dropout" - Kanye West',
      '"Late Registration" - Kanye West',
      '"Back to Black" - Amy Winehouse',
      '"B\'Day" - Beyoncé',
      '"Whatever People Say I Am" - Arctic Monkeys',
    ],
    definingSongs: [
      '"Through the Wire" - Kanye West',
      '"Back to Black" - Amy Winehouse',
      '"Hips Don\'t Lie" - Shakira ft. Wyclef Jean',
      '"Gold Digger" - Kanye West ft. Jamie Foxx',
      '"Wonderwall" - Oasis',
    ],
    mediaShifts: [
      "iTunes dominance",
      "Single-track economy",
      "MySpace discovery",
      "YouTube launches",
      "Streaming begins",
      "Album format declining",
    ],
  },
};

export async function generateStaticParams() {
  return Object.keys(erasData).map((id) => ({
    id,
  }));
}

export async function generateMetadata({
  params,
}: EraPageProps): Promise<Metadata> {
  const { id } = await params;
  const era = erasData[id];

  return {
    title: `${era?.title || "Era"} - Retroverse`,
    description: era?.summary || "Explore a music era",
  };
}

export default async function EraPage({ params }: EraPageProps) {
  const { id } = await params;
  const era = erasData[id];

  if (!era) {
    return (
      <div className="min-h-full bg-[var(--page-gradient)]">
        <article className="mx-auto max-w-2xl px-4 py-10 pb-16 sm:px-6 sm:py-14">
          <p className="text-[var(--text-secondary)]">Era not found</p>
          <Link href="/eras" className="text-[var(--accent-primary)] hover:underline">
            Back to Eras
          </Link>
        </article>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-2xl px-4 py-10 pb-16 sm:px-6 sm:py-14">
        {/* Header */}
        <header className="mb-10 space-y-4 sm:mb-12">
          <Link
            href="/eras"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <span>← Back</span>
          </Link>
          <div className="space-y-3 border-b border-[var(--card-border)]/50 pb-6">
            <div className="flex items-start justify-between gap-4">
              <h1 className="font-serif text-4xl font-normal leading-tight text-[var(--text-primary)] sm:text-5xl">
                {era.title}
              </h1>
              <div
                className="mt-2 h-4 w-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: era.accentColor }}
                aria-hidden
              />
            </div>
            <p className="text-sm font-medium text-[var(--text-secondary)] tabular-nums">
              {era.years}
            </p>
          </div>
        </header>

        {/* Summary */}
        <section className="mb-10 space-y-3 sm:mb-12" aria-labelledby="summary">
          <h2 id="summary" className="sr-only">
            Summary
          </h2>
          <p className="max-w-prose text-base leading-relaxed text-[var(--text-primary)] sm:text-lg">
            {era.summary}
          </p>
        </section>

        {/* Content Grid */}
        <div className="grid gap-8 sm:gap-10 lg:grid-cols-2">
          {/* Cultural Themes */}
          <section className="space-y-3" aria-labelledby="themes">
            <h2 id="themes" className="font-serif text-lg font-normal text-[var(--text-primary)]">
              Cultural Themes
            </h2>
            <ul className="space-y-2">
              {era.culturalThemes.map((theme) => (
                <li key={theme} className="flex gap-3 text-sm text-[var(--text-secondary)]">
                  <span className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0 bg-[var(--text-secondary)]/40" />
                  {theme}
                </li>
              ))}
            </ul>
          </section>

          {/* Defining Artists */}
          <section className="space-y-3" aria-labelledby="artists">
            <h2 id="artists" className="font-serif text-lg font-normal text-[var(--text-primary)]">
              Defining Artists
            </h2>
            <ul className="space-y-2">
              {era.definingArtists.map((artist) => (
                <li key={artist} className="text-sm text-[var(--text-secondary)]">
                  {artist}
                </li>
              ))}
            </ul>
          </section>

          {/* Defining Albums */}
          <section className="space-y-3 lg:col-span-2" aria-labelledby="albums">
            <h2 id="albums" className="font-serif text-lg font-normal text-[var(--text-primary)]">
              Defining Albums
            </h2>
            <ul className="space-y-2">
              {era.definingAlbums.map((album) => (
                <li key={album} className="text-sm text-[var(--text-secondary)]">
                  {album}
                </li>
              ))}
            </ul>
          </section>

          {/* Defining Songs */}
          <section className="space-y-3 lg:col-span-2" aria-labelledby="songs">
            <h2 id="songs" className="font-serif text-lg font-normal text-[var(--text-primary)]">
              Defining Songs
            </h2>
            <ul className="space-y-2">
              {era.definingSongs.map((song) => (
                <li key={song} className="text-sm text-[var(--text-secondary)]">
                  {song}
                </li>
              ))}
            </ul>
          </section>

          {/* Media & Technology Shifts */}
          <section className="space-y-3 lg:col-span-2" aria-labelledby="media">
            <h2 id="media" className="font-serif text-lg font-normal text-[var(--text-primary)]">
              Media &amp; Technology Shifts
            </h2>
            <ul className="space-y-2">
              {era.mediaShifts.map((shift) => (
                <li key={shift} className="flex gap-3 text-sm text-[var(--text-secondary)]">
                  <span className="mt-1.5 h-1 w-1 rounded-full flex-shrink-0 bg-[var(--text-secondary)]/40" />
                  {shift}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Footer Navigation */}
        <footer className="mt-12 border-t border-[var(--card-border)]/50 pt-6 sm:mt-16">
          <Link
            href="/eras"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--accent-primary)] hover:text-[var(--accent-primary)]/80 transition-colors"
          >
            ← Back to all eras
          </Link>
        </footer>
      </article>
    </div>
  );
}
