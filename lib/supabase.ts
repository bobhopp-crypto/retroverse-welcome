import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

export function createClient(): SupabaseClient {
  const client = tryCreateClient();
  if (!client) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY environment variables.",
    );
  }
  return client;
}

/** Returns null instead of throwing when Supabase env is missing or invalid. */
export function tryCreateClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    return createSupabaseClient(supabaseUrl, supabaseKey);
  } catch {
    return null;
  }
}
