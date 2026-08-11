// Supabase connection details.
//
// The anon/publishable key is safe to ship: it identifies the project, not a
// person, and every table is guarded by row-level security (see
// supabase/schema.sql). It is what Supabase intends browsers to hold. The
// service_role key is the opposite — it bypasses RLS entirely — and must never
// appear in this repo, in an env var read by Vite, or in any built asset.
//
// Vite inlines VITE_* values into the client bundle at build time, so anything
// put here is public by construction. Only ever put publishable values here.

const DEFAULT_URL = 'https://aglxlfufogqskhbobxsj.supabase.co';
const DEFAULT_ANON_KEY = 'sb_publishable_uUhZ2UDvcCBbLEeJHi1LPA_BqSekgmw';

/**
 * supabase-js wants the project origin, not a REST endpoint. The dashboard
 * sometimes hands you the URL with `/rest/v1/` appended, which produces
 * requests to `/rest/v1/rest/v1/...` and 404s that are irritating to diagnose,
 * so trim any path back to the origin.
 */
export function normaliseProjectUrl(raw) {
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return String(raw).replace(/\/+$/, '');
  }
}

export const SUPABASE_URL = normaliseProjectUrl(
  import.meta.env?.VITE_SUPABASE_URL || DEFAULT_URL,
);

export const SUPABASE_ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY || DEFAULT_ANON_KEY;

// A build with no project configured still runs — it just stays local-only.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Guard against the one mistake that would actually matter. A service_role key
// is a JWT whose payload contains "service_role"; the newer format is
// sb_secret_*. Either one in a browser bundle is a full data breach, so fail
// loudly at startup rather than shipping it.
export function assertNotSecretKey(key) {
  if (!key) return;
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'Refusing to start: a secret (sb_secret_*) key was supplied. Use the publishable/anon key.',
    );
  }
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') {
        throw new Error(
          'Refusing to start: a service_role key was supplied. Use the anon key — it bypasses row-level security.',
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Refusing to start')) throw err;
      // Not a JWT we can read; nothing to assert.
    }
  }
}
