import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolverIdentity } from "../lib/artwork-resolver-identity";

type SearchResult = {
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionId?: number;
  collectionType?: string;
};

type Candidate = {
  artist_name: string;
  collection_name: string;
  release_date: string | null;
  artwork_url_100: string | null;
  artwork_url_600: string | null;
  score: number;
  artist_score: number;
  title_score: number;
  year_score: number;
  penalties: string[];
  reasons: string[];
  query: string;
};

type Tier = "high" | "medium" | "unresolved";

type AcquisitionRow = {
  artist: string;
  title: string;
  tier: Tier;
  best_candidate: {
    artist_name: string;
    collection_name: string;
    score: number;
  } | null;
};

type AcquisitionSummary = {
  run_id: string;
  rows: AcquisitionRow[];
};

type SanityTarget = {
  artist: string;
  title: string;
  year: number | null;
  cohort:
    | "soundtrack"
    | "greatest_hits"
    | "self_titled"
    | "studio_classic"
    | "compilation";
};

const ITUNES_PASS_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass";
const DEBUG_ROOT = "/Users/bobhopp/RETROVERSE_DATA/logs/resolver-sanity";

const SANITY_SET: SanityTarget[] = [
  { artist: "Billy Joel", title: "The Nylon Curtain", year: 1982, cohort: "studio_classic" },
  { artist: "Bee Gees", title: "Saturday Night Fever", year: 1977, cohort: "soundtrack" },
  { artist: "Eagles", title: "Hotel California", year: 1976, cohort: "studio_classic" },
  { artist: "Fleetwood Mac", title: "Rumours", year: 1977, cohort: "studio_classic" },
  { artist: "Eagles", title: "Their Greatest Hits 1971-1975", year: 1976, cohort: "greatest_hits" },
  { artist: "Donna Summer", title: "On the Radio: Greatest Hits Volumes I & II", year: 1979, cohort: "greatest_hits" },
  { artist: "Grease", title: "Grease (The Original Soundtrack from the Motion Picture)", year: 1978, cohort: "soundtrack" },
  { artist: "Foreigner", title: "Foreigner", year: 1977, cohort: "self_titled" },
  { artist: "KC and the Sunshine Band", title: "Part 3", year: 1976, cohort: "self_titled" },
  { artist: "Earth, Wind & Fire", title: "The Best of Earth, Wind & Fire, Vol. 1", year: 1978, cohort: "compilation" },
];

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function normalizeAlias(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bost\b/g, " soundtrack ")
    .replace(/\boriginal soundtrack\b/g, " soundtrack ")
    .replace(/\boriginal motion picture soundtrack\b/g, " soundtrack ")
    .replace(/\bfeat(?:uring)?\b.*$/g, "")
    .replace(/['".,!?/\\:;`~*+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripParenthetical(value: string): string {
  return value.replace(/\(.*?\)/g, " ").replace(/\[.*?\]/g, " ");
}

function stripEditionSuffix(value: string): string {
  return value
    .replace(/\b(deluxe|expanded|remaster(?:ed)?|bonus track|special edition|anniversary edition)\b/gi, " ")
    .replace(/\b(version|edition)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSubtitle(value: string): string {
  return value
    .replace(/\s[-:]\s.*$/, "")
    .replace(/\b(original motion picture soundtrack|motion picture soundtrack|soundtrack|ost)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleCore(value: string): string {
  return normalizeAlias(stripSubtitle(stripEditionSuffix(stripParenthetical(value))))
    .replace(/\btheir greatest hits\b/g, "greatest hits")
    .replace(/\bgreatest hits\s+\d{4}\s*-\s*\d{4}\b/g, "greatest hits")
    .replace(/\boriginal cast recording\b/g, "soundtrack")
    .replace(/\bvol(?:ume)?\s*[ivx\d]+\b/g, " ")
    .replace(/\bii\b/g, "2")
    .replace(/\biii\b/g, "3")
    .replace(/\biv\b/g, "4")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value: string): string {
  return normalizeAlias(value).replace(/\b(the|a|an)\b/g, " ").replace(/\s+/g, " ").trim();
}

function titleTokens(value: string): string[] {
  const stop = new Set(["the", "a", "an", "and", "of", "to", "in", "for", "on", "at", "with", "from", "by", "album", "music"]);
  return normalizeTitleCore(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stop.has(token));
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function buildQueryVariants(artist: string, title: string, year: number | null): string[] {
  const titleCore = normalizeTitleCore(title);
  const artistNorm = normalizeAlias(artist);
  const variants = [
    `${artist} ${title}`,
    `${artist} ${titleCore}`,
    `${artistNorm} ${titleCore}`,
    `${artist} ${stripSubtitle(title)}`,
    `${artist} ${stripEditionSuffix(stripParenthetical(title))}`,
    `${titleCore} ${artistNorm}`,
  ]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query.length > 0);
  if (year) variants.push(`${artist} ${titleCore} ${year}`);
  return [...new Set(variants)];
}

function scoreCandidate(targetArtist: string, targetTitle: string, targetYear: number | null, raw: SearchResult, query: string): Candidate {
  const artist = raw.artistName?.trim() ?? "";
  const title = raw.collectionName?.trim() ?? "";

  const targetArtistKey = normalizeAlias(targetArtist);
  const targetArtistLoose = normalizeLoose(targetArtist);
  const targetTitleKey = normalizeAlias(targetTitle);
  const targetTitleLoose = normalizeLoose(targetTitle);
  const targetTitleCore = normalizeTitleCore(targetTitle);
  const targetTokens = titleTokens(targetTitle);

  const candArtistKey = normalizeAlias(artist);
  const candArtistLoose = normalizeLoose(artist);
  const candTitleKey = normalizeAlias(title);
  const candTitleLoose = normalizeLoose(title);
  const candTitleCore = normalizeTitleCore(title);
  const candTokens = titleTokens(title);

  let artistScore = 0;
  let titleScore = 0;
  let yearScore = 0;
  const penalties: string[] = [];
  const reasons: string[] = [];

  if (candArtistKey === targetArtistKey) {
    artistScore = 0.52;
    reasons.push("artist_exact");
  } else if (candArtistLoose === targetArtistLoose) {
    artistScore = 0.39;
    reasons.push("artist_loose");
  } else if (candArtistKey.includes(targetArtistLoose) || targetArtistLoose.includes(candArtistKey)) {
    artistScore = 0.24;
    reasons.push("artist_contains");
  }

  if (candTitleKey === targetTitleKey) {
    titleScore = 0.46;
    reasons.push("title_exact");
  } else if (candTitleCore === targetTitleCore && candTitleCore.length > 0) {
    titleScore = 0.38;
    reasons.push("title_core_exact");
  } else if (candTitleLoose === targetTitleLoose) {
    titleScore = 0.32;
    reasons.push("title_loose");
  } else if (candTitleCore.includes(targetTitleCore) || targetTitleCore.includes(candTitleCore)) {
    titleScore = 0.24;
    reasons.push("title_core_contains");
  } else if (candTitleKey.includes(targetTitleLoose) || targetTitleLoose.includes(candTitleKey)) {
    titleScore = 0.18;
    reasons.push("title_contains");
  }

  const tokenOverlap = jaccard(targetTokens, candTokens);
  if (tokenOverlap >= 0.75) {
    titleScore += 0.08;
    reasons.push("title_token_overlap_high");
  } else if (tokenOverlap >= 0.5) {
    titleScore += 0.04;
    reasons.push("title_token_overlap_medium");
  }

  if (targetYear !== null && raw.releaseDate) {
    const year = Number.parseInt(raw.releaseDate.slice(0, 4), 10);
    if (Number.isFinite(year)) {
      const delta = Math.abs(year - targetYear);
      if (delta <= 1) {
        yearScore = 0.08;
        reasons.push("year_near");
      } else if (delta <= 3) {
        yearScore = 0.04;
        reasons.push("year_close");
      } else if (delta >= 15) {
        penalties.push("penalty_year_far");
      }
    }
  }

  let penalty = 0;
  const penaltyTokens = ["karaoke", "tribute", "instrumental", "cover"];
  const combined = `${candArtistKey} ${candTitleKey}`;
  for (const token of penaltyTokens) {
    if (combined.includes(token)) {
      penalty += 0.2;
      penalties.push(`penalty_${token}`);
    }
  }
  if ((raw.collectionType ?? "").toLowerCase() === "single") {
    penalty += 0.1;
    penalties.push("penalty_single_type");
  }
  if ((raw.collectionType ?? "").toLowerCase() === "ep") {
    penalty += 0.06;
    penalties.push("penalty_ep_type");
  }

  const targetSoundtrack = /\bsoundtrack|ost|motion picture\b/i.test(targetTitle) || /\bvarious artists\b/i.test(targetArtist);
  const candidateSoundtrack = /\bsoundtrack|ost|motion picture\b/i.test(title);
  if (targetSoundtrack && candidateSoundtrack) {
    titleScore += 0.05;
    reasons.push("soundtrack_context_bonus");
  } else if (!targetSoundtrack && candidateSoundtrack) {
    penalty += 0.06;
    penalties.push("penalty_irrelevant_soundtrack");
  } else if (targetSoundtrack && !candidateSoundtrack) {
    penalty += 0.04;
    penalties.push("penalty_missing_soundtrack_context");
  }

  const targetCompilation = /\bgreatest hits|best of|anthology|collection|vol(?:ume)?\b/i.test(targetTitle);
  const candidateCompilation = /\bgreatest hits|best of|anthology|collection|vol(?:ume)?\b/i.test(title);
  if (candidateCompilation && !targetCompilation) {
    penalty += 0.08;
    penalties.push("penalty_compilation_mismatch");
  }
  const targetYearRange = targetTitle.match(/\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/);
  if (targetYearRange && !/\b(19|20)\d{2}\s*-\s*(19|20)\d{2}\b/.test(title)) {
    penalty += 0.12;
    penalties.push("penalty_missing_year_range");
  }
  const targetVol = targetTitle.match(/\bvol(?:ume)?\.?\s*([ivx\d]+)\b/i)?.[1] ?? null;
  const candVol = title.match(/\bvol(?:ume)?\.?\s*([ivx\d]+)\b/i)?.[1] ?? null;
  if (targetVol && candVol && normalizeAlias(targetVol) !== normalizeAlias(candVol)) {
    penalty += 0.08;
    penalties.push("penalty_volume_mismatch");
  } else if (targetVol && !candVol) {
    penalty += 0.06;
    penalties.push("penalty_missing_volume");
  } else if (!targetVol && candVol && !targetCompilation) {
    penalty += 0.05;
    penalties.push("penalty_unexpected_volume");
  }

  const targetSelfTitled = normalizeTitleCore(targetTitle) === normalizeAlias(targetArtist);
  const candidateSelfTitled = normalizeTitleCore(title) === normalizeAlias(artist);
  if (targetSelfTitled && candidateSelfTitled && artistScore >= 0.39) {
    titleScore += 0.06;
    reasons.push("self_titled_alignment_bonus");
  }

  const score = Math.max(0, Math.min(1, Number((artistScore + titleScore + yearScore - penalty).toFixed(3))));
  const artwork600 = raw.artworkUrl100
    ? raw.artworkUrl100.replace(/100x100bb/gi, "600x600bb").replace(/100x100-75/gi, "600x600-75")
    : null;

  return {
    artist_name: artist,
    collection_name: title,
    release_date: raw.releaseDate ?? null,
    artwork_url_100: raw.artworkUrl100 ?? null,
    artwork_url_600: artwork600,
    score,
    artist_score: Number(artistScore.toFixed(3)),
    title_score: Number(titleScore.toFixed(3)),
    year_score: Number(yearScore.toFixed(3)),
    penalties,
    reasons,
    query,
  };
}

function classifyTier(best: Candidate | null): Tier {
  if (!best) return "unresolved";
  if (best.score >= 0.9 && best.artist_score >= 0.32 && best.title_score >= 0.34) return "high";
  if (best.score >= 0.75 && best.artist_score >= 0.24 && best.title_score >= 0.24) return "medium";
  return "unresolved";
}

function confidenceBlockers(best: Candidate | null): string[] {
  if (!best) return ["no_candidate_returned"];
  const blockers: string[] = [];
  if (best.artist_score < 0.24) blockers.push("artist_agreement_too_weak");
  if (best.title_score < 0.24) blockers.push("title_agreement_too_weak");
  if (best.year_score === 0) blockers.push("year_alignment_missing");
  if (best.penalties.includes("penalty_compilation_mismatch")) blockers.push("compilation_mismatch");
  if (best.penalties.includes("penalty_irrelevant_soundtrack")) blockers.push("soundtrack_mismatch");
  if (best.score < 0.75) blockers.push("overall_score_below_medium_threshold");
  return blockers;
}

async function searchItunes(query: string): Promise<SearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=25`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: SearchResult[] };
  return json.results ?? [];
}

async function latestRefinementSummaryPath(): Promise<string | null> {
  const fs = await import("node:fs/promises");
  try {
    const entries = await fs.readdir(ITUNES_PASS_ROOT, { withFileTypes: true });
    const runs = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("itunes_unresolved_refine_"))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    if (!runs[0]) return null;
    return path.join(ITUNES_PASS_ROOT, runs[0], "metadata", "unresolved_refinement_summary.json");
  } catch {
    return null;
  }
}

function currentArchiveTier(summary: AcquisitionSummary | null, artist: string, title: string): Tier | "not_found" {
  if (!summary) return "not_found";
  const artistKey = normalizeAlias(artist);
  const titleKey = normalizeTitleCore(title);
  const match = summary.rows.find(
    (row) => normalizeAlias(row.artist) === artistKey && normalizeTitleCore(row.title) === titleKey,
  );
  return match?.tier ?? "not_found";
}

function classifyFailureType(
  candidates: Candidate[],
  best: Candidate | null,
  tier: Tier,
): {
  issue_type: "retrieval_failure" | "scoring_failure" | "filtering_failure" | "classification_failure" | "resolved";
  reason: string;
  recommended_fix_category: string;
} {
  if (candidates.length === 0 || !best) {
    return {
      issue_type: "retrieval_failure",
      reason: "No iTunes candidates returned for sanity queries.",
      recommended_fix_category: "query_generation",
    };
  }
  if (tier !== "unresolved") {
    return {
      issue_type: "resolved",
      reason: "Candidate resolved at medium/high tier.",
      recommended_fix_category: "none",
    };
  }
  const hasStrongArtist = candidates.some((candidate) => candidate.artist_score >= 0.24);
  const hasStrongTitle = candidates.some((candidate) => candidate.title_score >= 0.24);
  const hasNearThreshold = candidates.some((candidate) => candidate.score >= 0.68);

  if (!hasStrongArtist || !hasStrongTitle) {
    return {
      issue_type: "filtering_failure",
      reason: "Candidate set lacks sufficient artist/title agreement for obvious target.",
      recommended_fix_category: "normalization_alias_handling",
    };
  }
  if (hasNearThreshold && best.score < 0.75) {
    return {
      issue_type: "classification_failure",
      reason: "Near-threshold candidate exists but tiering/classification keeps it unresolved.",
      recommended_fix_category: "tiering_threshold_review",
    };
  }
  return {
    issue_type: "scoring_failure",
    reason: "Usable candidates returned but penalties/weights suppress final score.",
    recommended_fix_category: "scoring_weight_adjustment",
  };
}

async function main() {
  const runId = `resolver_sanity_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = path.join(DEBUG_ROOT, runId);
  await mkdir(runDir, { recursive: true });

  const latestSummaryPath = await latestRefinementSummaryPath();
  const latestSummary = latestSummaryPath ? await readJson<AcquisitionSummary>(latestSummaryPath) : null;

  const rows: Array<Record<string, unknown>> = [];
  const issueCounts = new Map<string, number>();

  for (const target of SANITY_SET) {
    const identity = resolverIdentity({
      canonical_album_title: target.title,
      canonical_artist_name: target.artist,
      release_year: target.year,
    });
    const queries = [...new Set([identity.artwork_search_query, ...buildQueryVariants(target.artist, target.title, target.year)])];
    const normalizedQueries = queries.map((query) => normalizeLoose(query));
    const byCollection = new Map<string, { raw: SearchResult; query: string }>();

    const queryDiagnostics: Array<{ query: string; normalized_query: string; returned_count: number }> = [];
    for (const query of queries) {
      const results = await searchItunes(query);
      queryDiagnostics.push({
        query,
        normalized_query: normalizeLoose(query),
        returned_count: results.length,
      });
      for (const raw of results) {
        const key = `${raw.collectionId ?? ""}::${raw.artistName ?? ""}::${raw.collectionName ?? ""}`;
        if (!byCollection.has(key)) byCollection.set(key, { raw, query });
      }
    }

    const scored = [...byCollection.values()]
      .map(({ raw, query }) => scoreCandidate(target.artist, target.title, target.year, raw, query))
      .sort((a, b) => b.score - a.score);
    const best = scored[0] ?? null;
    const tier = classifyTier(best);
    const blockers = confidenceBlockers(best);
    const failure = classifyFailureType(scored, best, tier);
    issueCounts.set(failure.issue_type, (issueCounts.get(failure.issue_type) ?? 0) + 1);

    const top10 = scored.slice(0, 10).map((candidate, idx) => ({
      rank: idx + 1,
      artist: candidate.artist_name,
      title: candidate.collection_name,
      score: candidate.score,
      artist_score: candidate.artist_score,
      title_score: candidate.title_score,
      year_score: candidate.year_score,
      query: candidate.query,
      penalties: candidate.penalties,
      reasons: candidate.reasons,
      rejected_why:
        idx === 0 && tier !== "unresolved"
          ? "selected"
          : candidate.score < 0.75
            ? "below_medium_threshold"
            : candidate.artist_score < 0.24
              ? "artist_agreement_too_weak"
              : candidate.title_score < 0.24
                ? "title_agreement_too_weak"
                : "ranked_below_top_candidate",
    }));

    rows.push({
      sanity_target: target,
      resolver_identity: identity,
      current_archive_tier: currentArchiveTier(latestSummary, target.artist, target.title),
      raw_queries_sent: queries,
      normalized_queries: normalizedQueries,
      query_diagnostics: queryDiagnostics,
      returned_candidate_count: scored.length,
      top_candidates: top10,
      best_candidate: best
        ? {
            artist: best.artist_name,
            title: best.collection_name,
            score: best.score,
            artist_score: best.artist_score,
            title_score: best.title_score,
            year_score: best.year_score,
            penalties: best.penalties,
            reasons: best.reasons,
            query: best.query,
          }
        : null,
      confidence_blockers: blockers,
      final_classification: tier,
      final_classification_reason:
        tier === "high"
          ? "meets high threshold"
          : tier === "medium"
            ? "meets medium threshold"
            : blockers.join(", "),
      issue_type: failure.issue_type,
      issue_reason: failure.reason,
      recommended_fix_category: failure.recommended_fix_category,
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    latest_refinement_summary: latestSummaryPath,
    sanity_set_size: SANITY_SET.length,
    issue_breakdown: Object.fromEntries([...issueCounts.entries()].sort((a, b) => b[1] - a[1])),
    rows,
  };

  const jsonPath = path.join(runDir, "resolver_sanity_report.json");
  const mdPath = path.join(runDir, "resolver_sanity_report.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const failing = rows.filter((row) => row.final_classification === "unresolved");
  const md = [
    `# Resolver Sanity Report ${runId}`,
    "",
    `- sanity set size: ${SANITY_SET.length}`,
    `- unresolved in sanity set: ${failing.length}`,
    `- issue breakdown: ${Object.entries(report.issue_breakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
    "",
    "## Obvious albums still failing (unresolved)",
    ...failing.map(
      (row) =>
        `- ${(row.sanity_target as SanityTarget).artist} - ${(row.sanity_target as SanityTarget).title} | issue=${String(
          row.issue_type,
        )} | reason=${String(row.issue_reason)} | blockers=${(row.confidence_blockers as string[]).join(", ") || "n/a"}`,
    ),
    "",
    "## Recommended fix categories (ranked)",
    ...Object.entries(
      rows.reduce<Record<string, number>>((acc, row) => {
        const key = String(row.recommended_fix_category);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}: ${v}`),
    "",
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  console.log(`resolver_sanity_json=${jsonPath}`);
  console.log(`resolver_sanity_md=${mdPath}`);
  console.log(`sanity_set_size=${SANITY_SET.length}`);
  console.log(`unresolved_in_sanity_set=${failing.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
