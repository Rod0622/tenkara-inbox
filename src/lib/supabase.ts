import { createClient } from "@supabase/supabase-js";

// Browser client (uses anon key, respects RLS).
//
// SINGLETON: this must return the SAME instance every time. Supabase's auth
// (GoTrueClient) keys off a single storage key per browser context; creating a
// new client on each call spawns multiple GoTrueClient instances sharing that
// key, which logs "Multiple GoTrueClient instances detected" and can cause
// undefined behaviour and re-render churn. This app calls createBrowserClient()
// from ~30 places (effects, handlers), so a fresh-client-per-call flooded the
// page with auth clients and could leave data-dependent panels unsettled
// (blank/distorted render on heavy conversations). Memoizing to one instance
// fixes it at the source without touching the call sites.
// Infer the exact client type (with the "inbox" schema generic) from the
// factory itself, so the singleton cache is typed correctly without forcing
// the wrong default "public" schema generic.
type BrowserClient = ReturnType<typeof makeBrowserClient>;

function makeBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "inbox" } }
  );
}

let _browserClient: BrowserClient | null = null;

export function createBrowserClient(): BrowserClient {
  if (_browserClient) return _browserClient;
  _browserClient = makeBrowserClient();
  return _browserClient;
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