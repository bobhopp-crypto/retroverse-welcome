import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolverIdentity } from "../lib/artwork-resolver-identity";

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
};

type AcquisitionRow = {
  album_id: string;
  artist: string;
  title: string;
  release_year: number | null;
  connected_track_count: number;
  charted_track_count: number;
  importance_score: number;
  tier: "high" | "medium" | "unresolved";
  best_candidate: Candidate | null;
  candidates: Candidate[];
  download_status: "downloaded" | "failed" | "not_attempted";
  staged_file: string | null;
  download_error: string | null;
  normalized_query?: string | null;
  top_candidate_rejection_reason?: string | null;
  confidence_blockers?: string[];
  pattern_category?: string;
};

type AcquisitionSummary = {
  generated_at: string;
  run_id: string;
  rows: AcquisitionRow[];
  outputs: {
    run_root: string;
  };
};

type SearchResult = {
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionId?: number;
  collectionType?: string;
};

type Tier = "high" | "medium" | "unresolved";

const ITUNES_PASS_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass";

function parseArgs(): { sourceSummaryArg: string | null } {
  const args = process.argv.slice(2);
  let sourceSummaryArg: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--source-summary" && args[i + 1]) {
      sourceSummaryArg = args[i + 1];
      i += 1;
    }
  }
  return { sourceSummaryArg };
}

async function latestSummaryPath(): Promise<string> {
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(ITUNES_PASS_ROOT, { withFileTypes: true });
  const refineDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("itunes_unresolved_refine_"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (refineDirs.length > 0) {
    return path.join(ITUNES_PASS_ROOT, refineDirs[0], "metadata", "unresolved_refinement_summary.json");
  }
  const canonicalDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("itunes_canonical_pass_"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (canonicalDirs.length === 0) throw new Error(`No iTunes pass directory found under ${ITUNES_PASS_ROOT}`);
  return path.join(ITUNES_PASS_ROOT, canonicalDirs[0], "metadata", "itunes_acquisition_summary.json");
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
    .replace(/\bthe commodores\b/g, "commodores")
    .replace(/\bac\/dc\b/g, "ac dc")
    .replace(/\bearth,\s*wind\s*&\s*fire\b/g, "earth wind and fire")
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
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "of",
    "to",
    "in",
    "for",
    "on",
    "at",
    "with",
    "from",
    "by",
    "album",
    "music",
    "songs",
  ]);
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function classifyFailurePattern(row: AcquisitionRow): string[] {
  const flags: string[] = [];
  const title = row.title.toLowerCase();
  if (/[()]/.test(row.title)) flags.push("parentheses_variant");
  if (/[’'".,:;!?-]/.test(row.title)) flags.push("punctuation_variant");
  if (/[&]/.test(row.artist) || /\band\b/i.test(row.artist)) flags.push("and_ampersand_alias");
  if (/soundtrack|original motion picture/i.test(row.title) || /various artists/i.test(row.artist)) flags.push("soundtrack_or_various");
  if (/greatest hits|best of|anthology|collection/i.test(row.title)) flags.push("greatest_hits_wording");
  if (/vol\.?|volume\s+[ivx\d]+/i.test(row.title)) flags.push("volume_numbering");
  if (/deluxe|remaster|edition|bonus/i.test(row.title)) flags.push("edition_remaster_suffix");
  if (title.includes(":") || title.includes(" - ")) flags.push("subtitle_mismatch");
  if (normalizeTitleCore(row.title) === normalizeAlias(row.artist)) flags.push("self_titled_ambiguity");
  if (!row.best_candidate) flags.push("no_candidate_returned");
  if (row.best_candidate && row.best_candidate.title_score > 0 && row.best_candidate.artist_score === 0) flags.push("title_only_without_artist");
  return [...new Set(flags)];
}

function classifyPatternCategory(flags: string[]): string {
  if (flags.includes("soundtrack_or_various")) return "soundtrack_ambiguity";
  if (flags.includes("self_titled_ambiguity")) return "self_titled_ambiguity";
  if (flags.includes("greatest_hits_wording")) return "compilation_wording";
  if (flags.includes("title_only_without_artist")) return "title_collision";
  if (flags.includes("and_ampersand_alias")) return "artist_alias_mismatch";
  if (flags.includes("edition_remaster_suffix")) return "edition_remaster_drift";
  if (flags.includes("volume_numbering")) return "volume_numbering";
  if (flags.includes("punctuation_variant") || flags.includes("parentheses_variant")) return "punctuation_or_parenthetical";
  if (flags.includes("no_candidate_returned")) return "no_candidate_returned";
  return "weak_common_title_phrase";
}

function buildQueryVariants(artist: string, title: string, releaseYear: number | null): string[] {
  const titleCore = normalizeTitleCore(title);
  const artistNorm = normalizeAlias(artist);
  const variants = [
    `${artist} ${title}`,
    `${artist} ${titleCore}`,
    `${artistNorm} ${titleCore}`,
    `${artist} ${stripSubtitle(title)}`,
    `${artist} ${stripEditionSuffix(stripParenthetical(title))}`,
    `${titleCore} ${artistNorm}`,
  ].map((q) => q.replace(/\s+/g, " ").trim());
  if (releaseYear) variants.push(`${artist} ${titleCore} ${releaseYear}`);
  return [...new Set(variants.filter((q) => q.length > 0))];
}

function scoreCandidate(targetArtist: string, targetTitle: string, targetYear: number | null, raw: SearchResult): Candidate {
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
        yearScore = 0;
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

  // Prefer soundtrack-labeled candidates only when target implies soundtrack.
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

  // Penalize broad compilations unless target itself is compilation.
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

function topRejectionReason(best: Candidate | null): string {
  if (!best) return "no_candidate_returned";
  const blockers = confidenceBlockers(best);
  return blockers[0] ?? "none";
}

async function searchItunes(query: string): Promise<SearchResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=album&limit=12`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: SearchResult[] };
  return json.results ?? [];
}

async function download(url: string, filePath: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download_failed_${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(filePath, bytes);
  return bytes.length;
}

async function main() {
  const { sourceSummaryArg } = parseArgs();
  const sourceSummaryPath = sourceSummaryArg ?? (await latestSummaryPath());
  const raw = await readFile(sourceSummaryPath, "utf8");
  const source = JSON.parse(raw) as AcquisitionSummary;

  const unresolvedBefore = source.rows.filter((row) => row.tier === "unresolved");
  const beforePatternCounts = new Map<string, number>();
  for (const row of unresolvedBefore) {
    for (const flag of classifyFailurePattern(row)) {
      beforePatternCounts.set(flag, (beforePatternCounts.get(flag) ?? 0) + 1);
    }
  }

  const runId = `itunes_unresolved_refine_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runRoot = path.join(ITUNES_PASS_ROOT, runId);
  const stageHigh = path.join(runRoot, "staging", "high");
  const stageMedium = path.join(runRoot, "staging", "medium");
  const metaDir = path.join(runRoot, "metadata");
  await mkdir(stageHigh, { recursive: true });
  await mkdir(stageMedium, { recursive: true });
  await mkdir(metaDir, { recursive: true });

  const refinedRows: Array<
    AcquisitionRow & {
      resolver_identity: ReturnType<typeof resolverIdentity>;
      query_variants: string[];
      query_used_for_best: string | null;
      candidate_pool_size: number;
      before_patterns: string[];
      normalized_query: string | null;
      top_candidate_rejection_reason: string | null;
      confidence_blockers: string[];
      pattern_category: string;
      normalization_path: {
        artist_normalized: string;
        title_core: string;
        title_tokens: string[];
      };
    }
  > = [];

  let downloadSuccess = 0;
  let downloadFailure = 0;

  for (const row of unresolvedBefore) {
    const identity = resolverIdentity({
      canonical_album_title: row.title,
      canonical_artist_name: row.artist,
      release_year: row.release_year,
    });
    const queries = [...new Set([identity.artwork_search_query, ...buildQueryVariants(row.artist, row.title, row.release_year)])];
    const candidateMap = new Map<string, { raw: SearchResult; query: string }>();

    for (const query of queries) {
      const results = await searchItunes(query);
      for (const rawItem of results) {
        const key = `${rawItem.collectionId ?? ""}::${rawItem.artistName ?? ""}::${rawItem.collectionName ?? ""}`;
        if (!candidateMap.has(key)) candidateMap.set(key, { raw: rawItem, query });
      }
    }

    const scored = [...candidateMap.values()]
      .map(({ raw, query }) => ({
        ...scoreCandidate(row.artist, row.title, row.release_year, raw),
        __query: query,
      }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0] ?? null;
    const tier = classifyTier(best);
    const beforePatterns = classifyFailurePattern(row);
    const normalizedQuery = best ? normalizeLoose(best.__query) : normalizeLoose(queries[0] ?? "");
    const blockers = confidenceBlockers(best);
    const patternCategory = classifyPatternCategory(beforePatterns);

    let downloadStatus: "downloaded" | "failed" | "not_attempted" = "not_attempted";
    let stagedFile: string | null = null;
    let downloadError: string | null = null;
    if ((tier === "high" || tier === "medium") && best?.artwork_url_600) {
      const targetDir = tier === "high" ? stageHigh : stageMedium;
      const filename = `${row.album_id}__${slugify(row.artist)}__${slugify(row.title)}.jpg`;
      const absPath = path.join(targetDir, filename);
      try {
        const size = await download(best.artwork_url_600, absPath);
        if (size >= 10_000) {
          downloadStatus = "downloaded";
          stagedFile = absPath;
          downloadSuccess += 1;
        } else {
          downloadStatus = "failed";
          downloadError = `image_too_small_${size}`;
          downloadFailure += 1;
        }
      } catch (err) {
        downloadStatus = "failed";
        downloadError = err instanceof Error ? err.message : "download_error";
        downloadFailure += 1;
      }
    }

    refinedRows.push({
      ...row,
      tier,
      best_candidate: best
        ? {
            artist_name: best.artist_name,
            collection_name: best.collection_name,
            release_date: best.release_date,
            artwork_url_100: best.artwork_url_100,
            artwork_url_600: best.artwork_url_600,
            score: best.score,
            artist_score: best.artist_score,
            title_score: best.title_score,
            year_score: best.year_score,
            penalties: best.penalties,
            reasons: best.reasons,
          }
        : null,
      candidates: scored.slice(0, 6).map((cand) => ({
        artist_name: cand.artist_name,
        collection_name: cand.collection_name,
        release_date: cand.release_date,
        artwork_url_100: cand.artwork_url_100,
        artwork_url_600: cand.artwork_url_600,
        score: cand.score,
        artist_score: cand.artist_score,
        title_score: cand.title_score,
        year_score: cand.year_score,
        penalties: [...cand.penalties, `query:${cand.__query}`],
        reasons: cand.reasons,
      })),
      download_status: downloadStatus,
      staged_file: stagedFile,
      download_error: downloadError,
      query_variants: queries,
      resolver_identity: identity,
      query_used_for_best: best ? best.__query : null,
      candidate_pool_size: scored.length,
      before_patterns: beforePatterns,
      normalized_query: normalizedQuery || null,
      top_candidate_rejection_reason: tier === "unresolved" ? topRejectionReason(best) : null,
      confidence_blockers: tier === "unresolved" ? blockers : [],
      pattern_category: tier === "unresolved" ? patternCategory : "resolved",
      normalization_path: {
        artist_normalized: normalizeAlias(row.artist),
        title_core: normalizeTitleCore(row.title),
        title_tokens: titleTokens(row.title),
      },
    });
  }

  const high = refinedRows.filter((row) => row.tier === "high");
  const medium = refinedRows.filter((row) => row.tier === "medium");
  const unresolvedAfter = refinedRows.filter((row) => row.tier === "unresolved");

  const afterPatternCounts = new Map<string, number>();
  const afterPatternBuckets = new Map<string, number>();
  for (const row of unresolvedAfter) {
    for (const flag of classifyFailurePattern(row)) {
      afterPatternCounts.set(flag, (afterPatternCounts.get(flag) ?? 0) + 1);
    }
    afterPatternBuckets.set(row.pattern_category ?? "unknown", (afterPatternBuckets.get(row.pattern_category ?? "unknown") ?? 0) + 1);
  }

  const autoLikelyRecoverable = unresolvedAfter.filter((row) =>
    (row.confidence_blockers ?? []).every((blocker) => blocker !== "no_candidate_returned"),
  ).length;
  const manualLikely = unresolvedAfter.length - autoLikelyRecoverable;

  const report = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    source_summary: sourceSummaryPath,
    unresolved_before: unresolvedBefore.length,
    unresolved_after: unresolvedAfter.length,
    new_high_confidence: high.length,
    new_medium_confidence: medium.length,
    remaining_unresolved: unresolvedAfter.length,
    downloads: {
      success: downloadSuccess,
      failure: downloadFailure,
    },
    pattern_counts: {
      before: Object.fromEntries([...beforePatternCounts.entries()].sort((a, b) => b[1] - a[1])),
      after: Object.fromEntries([...afterPatternCounts.entries()].sort((a, b) => b[1] - a[1])),
    },
    pattern_buckets_ranked: Object.fromEntries([...afterPatternBuckets.entries()].sort((a, b) => b[1] - a[1])),
    recoverability_estimate: {
      likely_auto_recoverable_count: autoLikelyRecoverable,
      likely_auto_recoverable_pct: unresolvedAfter.length === 0 ? 0 : Number(((autoLikelyRecoverable / unresolvedAfter.length) * 100).toFixed(1)),
      likely_manual_only_count: manualLikely,
      likely_manual_only_pct: unresolvedAfter.length === 0 ? 0 : Number(((manualLikely / unresolvedAfter.length) * 100).toFixed(1)),
    },
    outputs: {
      run_root: runRoot,
      staged_high_dir: stageHigh,
      staged_medium_dir: stageMedium,
    },
    rows: refinedRows,
  };

  const jsonPath = path.join(metaDir, "unresolved_refinement_summary.json");
  const mdPath = path.join(metaDir, "unresolved_refinement_summary.md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const md = [
    `# Unresolved iTunes Refinement ${runId}`,
    "",
    `- source unresolved before: ${report.unresolved_before}`,
    `- unresolved after: ${report.unresolved_after}`,
    `- new high confidence: ${report.new_high_confidence}`,
    `- new medium confidence: ${report.new_medium_confidence}`,
    `- remaining unresolved: ${report.remaining_unresolved}`,
    `- download success: ${report.downloads.success}`,
    `- download failure: ${report.downloads.failure}`,
    "",
    "## Top remaining failure categories (after)",
    ...Object.entries(report.pattern_counts.after)
      .slice(0, 12)
      .map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Ranked blocker buckets (after)",
    ...Object.entries(report.pattern_buckets_ranked)
      .slice(0, 12)
      .map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Recoverability estimate",
    `- likely auto-recoverable: ${report.recoverability_estimate.likely_auto_recoverable_count} (${report.recoverability_estimate.likely_auto_recoverable_pct}%)`,
    `- likely manual-only: ${report.recoverability_estimate.likely_manual_only_count} (${report.recoverability_estimate.likely_manual_only_pct}%)`,
    "",
    "## New high-confidence candidates (first 25)",
    ...high.slice(0, 25).map((row) => `- ${row.album_id} | ${row.artist} - ${row.title} | score=${row.best_candidate?.score ?? "n/a"} | query=${row.query_used_for_best ?? "n/a"} | staged=${row.staged_file ? "yes" : "no"}`),
    "",
    "## New medium-confidence candidates (first 25)",
    ...medium.slice(0, 25).map((row) => `- ${row.album_id} | ${row.artist} - ${row.title} | score=${row.best_candidate?.score ?? "n/a"} | query=${row.query_used_for_best ?? "n/a"} | staged=${row.staged_file ? "yes" : "no"}`),
    "",
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  console.log(`unresolved_refine_root=${runRoot}`);
  console.log(`unresolved_refine_json=${jsonPath}`);
  console.log(`unresolved_refine_md=${mdPath}`);
  console.log(`unresolved_before=${report.unresolved_before}`);
  console.log(`unresolved_after=${report.unresolved_after}`);
  console.log(`new_high_confidence=${report.new_high_confidence}`);
  console.log(`new_medium_confidence=${report.new_medium_confidence}`);
  console.log(`remaining_unresolved=${report.remaining_unresolved}`);
  console.log(`download_success=${report.downloads.success}`);
  console.log(`download_failure=${report.downloads.failure}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
