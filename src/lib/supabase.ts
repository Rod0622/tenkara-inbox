import { createClient } from "@supabase/supabase-js";

// Browser client singleton (uses anon key, respects RLS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browserClient: any = null;

export function createBrowserClient() {
  if (!_browserClient) {
    _browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { db: { schema: "inbox" } }
    );
  }
  return _browserClient as ReturnType<typeof createClient>;
}

// Server client (uses service role, bypasses RLS)
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { 
      auth: { persistSession: false },
      db: { schema: "inbox" }
    }
  );
}