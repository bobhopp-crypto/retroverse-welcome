/**
 * Resolves iTunes Search API artwork → ../albums.json
 * Run from repo: node portal-prototype/scripts/build-albums-json.mjs
 *
 * Uses curl subprocess: Node fetch() often gets HTTP 403 from Apple; curl + Safari UA succeeds.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TARGET = join(__dirname, "..", "albums.json");

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * @param {string} artist
 * @param {string} title
 */
async function artworkFor(artist, title) {
  const term = `${artist} ${title}`;
  const u =
    "https://itunes.apple.com/search?" +
    new URLSearchParams({ term, entity: "album", limit: "8", country: "US" });

  const safariUA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

  let attempt = 0;

  /** @type {unknown} */

  let j;
  /** @type {number} */

  let lastBackoff = 0;

  const maxAttempts = 22;

  while (attempt < maxAttempts) {
    attempt += 1;
    /** @type {string} */

    let raw;

    try {
      raw = execFileSync(
        "curl",
        ["-sS", "-L", "-A", safariUA, "-H", "Accept: application/json", u],
        { encoding: "utf8", maxBuffer: 25 * 1024 * 1024 },
      );

      j = JSON.parse(raw);
      if (Array.isArray(/** @type any */ (j).results) && /** @type any */ (j).results.length) break;

      throw new Error("empty results");

    } catch (/** @type {unknown} */ err) {

      lastBackoff = Math.min(64000, 1800 + lastBackoff + Math.round(Math.random() * 900));

      console.warn(`${String(err)} | retry ${attempt}/${maxAttempts} in ${lastBackoff}ms (${term.slice(0, 48)})`);
      await sleep(lastBackoff);

    }

  }

  if (!/** @type any */ (j)?.results?.length) throw new Error(`no data: ${term}`);
  const results = /** @type {{results:any[]}} */ (j).results;
  if (!results.length) throw new Error(`empty: ${term}`);

  const wantT = title.toLowerCase().replace(/['’]/g, "'").normalize("NFKD");
  /** @type {{artistName:string;collectionName:string;artworkUrl100:string}|undefined} */

  const pick =
    results.find((/** @type any */ a) => {

      const tn = String(a.collectionName ?? "").toLowerCase();

      const short = wantT.replace(/^(.{4,30}).*$/u, "$1");
      return tn.includes(short) || wantT.includes(tn.slice(0, 22));
    }) ?? results[0];

  if (!pick?.artworkUrl100) throw new Error(`no art: ${term}`);

  let cover = String(pick.artworkUrl100).replace(/100x100bb/gu, "600x600bb");
  if (!/600x600/u.test(cover))
    cover = String(pick.artworkUrl100).replace(/\/\d+x\d+u?\.jpg/u, "/600x600bb.jpg");

  return { artist, title, cover };
}

/**
 * Real release-year bins; 8–12 titles each. Order = loose chron / catalogue feel.
 * @type {{year:number;albums:[string,string][]}[]}
 */
const YEARS = [
  {
    year: 1967,
    albums: [
      ["The Beatles", "Sgt. Pepper's Lonely Hearts Club Band"],
      ["Pink Floyd", "The Piper at the Gates of Dawn"],
      ["The Doors", "The Doors"],
      ["The Jimi Hendrix Experience", "Are You Experienced"],
      ["The Velvet Underground & Nico", "The Velvet Underground & Nico"],
      ["Cream", "Disraeli Gears"],
      ["Jefferson Airplane", "Surrealistic Pillow"],
      ["The Who", "The Who Sell Out"],
      ["The Rolling Stones", "Their Satanic Majesties Request"],
      ["Love", "Forever Changes"],
      ["The Moody Blues", "Days of Future Passed"],
      ["Procol Harum", "Procol Harum"],
    ],
  },
  {
    year: 1969,
    albums: [
      ["The Beatles", "Abbey Road"],
      ["Led Zeppelin", "Led Zeppelin"],
      ["Led Zeppelin", "Led Zeppelin II"],
      ["The Rolling Stones", "Let It Bleed"],
      ["Bob Dylan", "Nashville Skyline"],
      ["King Crimson", "In the Court of the Crimson King"],
      ["The Band", "The Band"],
      ["Creedence Clearwater Revival", "Willy And The Poor Boys"],
      ["Crosby, Stills & Nash", "Crosby, Stills & Nash"],
      ["Sly & The Family Stone", "Stand!"],
      ["The Velvet Underground", "The Velvet Underground"],
      ["Flying Burrito Brothers", "The Gilded Palace of Sin"],
    ],
  },
  {
    year: 1971,
    albums: [
      ["Marvin Gaye", "What's Going On"],
      ["Led Zeppelin", "Led Zeppelin IV"],
      ["Joni Mitchell", "Blue"],
      ["Carole King", "Tapestry"],
      ["The Who", "Who's Next"],
      ["David Bowie", "Hunky Dory"],
      ["John Lennon", "Imagine"],
      ["The Rolling Stones", "Sticky Fingers"],
      ["Alice Cooper", "Killer"],
      ["Yes", "Fragile"],
      ["Rod Stewart", "Every Picture Tells a Story"],
      ["Isaac Hayes", "Shaft"],

    ],
  },
  {

    year: 1973,
    albums: [
      ["Pink Floyd", "The Dark Side of the Moon"],
      ["Led Zeppelin", "Houses of the Holy"],
      ["Elton John", "Goodbye Yellow Brick Road"],
      ["Paul McCartney & Wings", "Band On the Run"],
      ["Stevie Wonder", "Innervisions"],
      ["Genesis", "Selling England By the Pound"],
      ["Queen", "Sheer Heart Attack"],
      ["Steely Dan", "Pretzel Logic"],
      ["Lynyrd Skynyrd", "(Pronounced 'Lĕh-'nérd 'Skin-'nérd)"],
      ["Herbie Hancock", "Head Hunters"],
      ["Mike Oldfield", "Tubular Bells"],
      ["David Bowie", "Pin Ups"],

    ],
  },
  {
    year: 1975,
    albums: [
      ["Pink Floyd", "Wish You Were Here"],
      ["Bruce Springsteen", "Born to Run"],
      ["Fleetwood Mac", "Fleetwood Mac"],
      ["Bob Dylan", "Blood On the Tracks"],
      ["Earth, Wind & Fire", "That's the Way of the World"],
      ["Queen", "A Night at the Opera"],
      ["Led Zeppelin", "Physical Graffiti"],
      ["Neil Young", "Tonight's the Night"],
      ["Patti Smith", "Horses"],
      ["Jeff Beck", "Blow By Blow"],
      ["Kraftwerk", "Radio-Activity"],
      ["David Bowie", "Young Americans"],
    ],
  },
  {
    year: 1977,
    albums: [
      ["Fleetwood Mac", "Rumours"],
      ["Steely Dan", "Aja"],
      ["David Bowie", "Low"],
      ["Television", "Marquee Moon"],
      ["Sex Pistols", "Never Mind the Bollocks, Here's the Sex Pistols"],
      ["Talking Heads", "Talking Heads: 77"],
      ["Bob Marley & The Wailers", "Exodus"],
      ["Peter Gabriel", "Peter Gabriel 1"],
      ["Electric Light Orchestra", "Out of the Blue"],
      ["Meat Loaf", "Bat Out of Hell"],
      ["Chic", "C'est Chic"],
      ["Elvis Costello", "My Aim Is True"],
    ],
  },
  {
    year: 1979,
    albums: [
      ["The Clash", "London Calling"],
      ["Pink Floyd", "The Wall"],
      ["Michael Jackson", "Off the Wall"],
      ["AC/DC", "Highway to Hell"],
      ["Supertramp", "Breakfast In America"],
      ["Fleetwood Mac", "Tusk"],
      ["Cheap Trick", "Cheap Trick At Budokan"],
      ["Talking Heads", "Fear of Music"],
      ["Elvis Costello", "Armed Forces"],
      ["The Police", "Reggatta De Blanc"],
      ["Gary Numan", "The Pleasure Principle"],
      ["The Pretenders", "Pretenders"],
    ],
  },
  {
    year: 1981,
    albums: [
      ["Phil Collins", "Face Value"],
      ["Rush", "Moving Pictures"],
      ["Journey", "Escape"],
      ["The Go-Go's", "Beauty and the Beat"],
      ["Kim Wilde", "Kim Wilde"],
      ["Foreigner", "4"],
      ["The Rolling Stones", "Tattoo You"],
      ["The Police", "Ghost in the Machine"],
      ["Kraftwerk", "Computer World"],
      ["Prince", "Controversy"],
      ["Hall & Oates", "Private Eyes"],
      ["Rick Springfield", "Working Class Dog"],
    ],
  },
  {
    year: 1984,
    albums: [
      ["Prince", "Purple Rain"],
      ["Bruce Springsteen", "Born in the U.S.A."],
      ["Madonna", "Like a Virgin"],
      ["Van Halen", "1984"],
      ["U2", "The Unforgettable Fire"],
      ["Metallica", "Ride the Lightning"],
      ["Sade", "Diamond Life"],
      ["Tina Turner", "Private Dancer"],
      ["Frankie Goes to Hollywood", "Welcome to the Pleasuredome"],
      ["Talking Heads", "Stop Making Sense"],
      ["The Cars", "Heartbeat City"],
      ["Echo & the Bunnymen", "Ocean Rain"],
    ],
  },
];

async function main() {
  /** @type {{ year: number; albums: { artist: string; title: string; cover: string }[] }[]} */
  const out = [];

  for (const block of YEARS) {
    const albums = [];
    for (const [artist, title] of block.albums) {
      const a = artist.trim();
      const t = title.trim();
      albums.push(await artworkFor(a, t));
      await sleep(2600);
    }

    out.push({ year: block.year, albums });
  }

  writeFileSync(TARGET, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  const n = out.reduce((s, b) => s + b.albums.length, 0);
  console.log("Wrote", TARGET, "→", out.length, "years,", n, "albums");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
