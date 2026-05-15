/**
 * Prints JSON from canonical_album_chart_validation_report (after migration).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage: pnpm exec tsx scripts/validate_canonical_album_chart_runs.ts [album_id]
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const albumId = process.argv[2] ?? "RVAL000003";
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("canonical_album_chart_validation_report", {
    p_album_id: albumId,
  });
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(JSON.stringify(data, null, 2));
}

main();
