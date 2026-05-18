import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { curatorPipelineLog } from "@/lib/curator-pipeline-log";

function tryServiceSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function nextArtworkId(
  // Supabase generic schema is not wired in this app — mirror uses service role only.
  supabase: { from: (table: string) => { select: (cols: string) => unknown } },
): Promise<string> {
  const q = supabase.from("retroverse_album_artwork").select("retroverse_album_artwork_id") as {
    order: (col: string, opts: { ascending: boolean }) => {
      limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  const { data, error } = await q.order("retroverse_album_artwork_id", { ascending: false }).limit(1);
  if (error) throw error;
  const rows = (data ?? []) as { retroverse_album_artwork_id?: string }[];
  const last = rows[0]?.retroverse_album_artwork_id;
  if (typeof last === "string" && /^ART\d+$/i.test(last)) {
    const n = Number.parseInt(last.slice(3), 10);
    return `ART${String(n + 1).padStart(8, "0")}`;
  }
  return "ART00000001";
}

/**
 * Mirror curator cover decision to Supabase (non-authoritative during migration).
 * Failures are logged; callers decide whether to fail the HTTP request.
 */
export async function mirrorCanonicalArtworkToSupabase(input: {
  albumId: string;
  canonicalCoverPath: string | null;
  artworkStatus: string;
  coverSource: string;
  notes?: string;
  traceId?: string;
}): Promise<{ ok: true; skipped?: boolean } | { ok: false; error: string }> {
  const supabase = tryServiceSupabase();
  if (!supabase) {
    curatorPipelineLog("supabase_mirror", {
      traceId: input.traceId,
      ok: true,
      skipped: true,
      reason: "missing_service_role_env",
    });
    return { ok: true, skipped: true };
  }

  const albumId = input.albumId.trim().toUpperCase();
  try {
    const { data: rawRows, error: selectError } = await supabase
      .from("retroverse_album_artwork")
      .select("retroverse_album_artwork_id, is_primary, artwork_role")
      .eq("retroverse_album_id", albumId);
    if (selectError) throw selectError;

    const rows = (rawRows ?? []) as {
      retroverse_album_artwork_id: string;
      is_primary?: boolean | null;
      artwork_role?: string | null;
    }[];

    const primary =
      rows.find((r) => r.is_primary && r.artwork_role === "primary") ??
      rows.find((r) => r.is_primary) ??
      rows[0];

    const payload = {
      canonical_cover_path: input.canonicalCoverPath,
      cover_source: input.coverSource,
      artwork_status: input.artworkStatus,
      artwork_role: "primary" as const,
      is_primary: true,
      notes: input.notes ?? null,
    };

    if (primary?.retroverse_album_artwork_id) {
      const { error } = await supabase
        .from("retroverse_album_artwork")
        .update(payload)
        .eq("retroverse_album_artwork_id", primary.retroverse_album_artwork_id);
      if (error) throw error;
    } else {
      const newId = await nextArtworkId(supabase);
      const { error } = await supabase.from("retroverse_album_artwork").insert({
        retroverse_album_artwork_id: newId,
        retroverse_album_id: albumId,
        retroverse_album_edition_id: null,
        ...payload,
        width_px: null,
        height_px: null,
      });
      if (error) throw error;
    }

    curatorPipelineLog("supabase_mirror", {
      traceId: input.traceId,
      ok: true,
      albumId,
      canonicalCoverPath: input.canonicalCoverPath,
    });
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    curatorPipelineLog("supabase_mirror", {
      traceId: input.traceId,
      ok: false,
      albumId,
      error,
    });
    return { ok: false, error };
  }
}
