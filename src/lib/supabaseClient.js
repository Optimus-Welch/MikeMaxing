import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isSupabaseConfigured,
  assertNotSecretKey,
} from './supabaseConfig.js';

// One client for the app, created LAZILY on first use.
//
// Not at module scope: createClient() eagerly builds a realtime client, which
// needs a native WebSocket. Browsers always have one, but Node only gained it
// in v22 — so merely importing anything in the sync chain crashed under Node
// 20, which is what CI runs. That made the sync modules impossible to import
// in a test without dragging a WebSocket stack in behind them.
//
// Deferring construction also means a signed-out user who never opens Settings
// pays nothing for a client they never use. We do not use realtime at all.

assertNotSecretKey(SUPABASE_ANON_KEY);

/**
 * Whether a project is configured. Deliberately derived from config alone, so
 * asking the question never constructs a client.
 */
export const hasCloud = isSupabaseConfigured;

let client = null;

/** The shared client, or null when no project is configured. */
export function getSupabase() {
  if (!isSupabaseConfigured) return null;
  if (client) return client;

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // PKCE returns from the magic link as `?code=...` in the QUERY string.
      // The default implicit flow returns `#access_token=...` in the HASH,
      // which collides head-on with HashRouter — the app routes on the hash,
      // so the token either clobbers the route or the router eats the token.
      // PKCE sidesteps that entirely and is the more secure flow anyway.
      flowType: 'pkce',
      detectSessionInUrl: true,
    },
  });
  return client;
}

/** Test hook: drop the memoised client so the next call rebuilds it. */
export function __resetSupabaseClient() {
  client = null;
}
