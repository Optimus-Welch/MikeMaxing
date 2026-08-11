import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  isSupabaseConfigured,
  assertNotSecretKey,
} from './supabaseConfig.js';

// One client for the app. Null when no project is configured, which keeps the
// app fully usable as a local-only install rather than crashing on boot.

assertNotSecretKey(SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
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
    })
  : null;

export const hasCloud = supabase != null;
