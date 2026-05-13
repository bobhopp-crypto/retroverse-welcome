import type { SupabaseClient } from "@supabase/supabase-js";

/** Service-role / app helpers: avoids `ReturnType<typeof createClient>` inferring Schema as `never`. */
export type RetroverseSupabase = SupabaseClient<any, "public", any>;
