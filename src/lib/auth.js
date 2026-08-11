import { getSupabase, hasCloud } from './supabaseClient.js';

// Passwordless email sign-in. Supabase treats magic-link sign-in and sign-up
// as the same call, so there is no separate registration step — entering an
// email either signs you in or creates the account and signs you in.

/**
 * Where the magic link should land.
 *
 * Must be an exact match for one of the Redirect URLs configured in
 * Supabase (Authentication -> URL Configuration), or the link bounces to the
 * Site URL instead. Includes the trailing `#/` so the app boots on its Today
 * route rather than an empty hash.
 */
export function redirectTarget() {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/`;
}

export async function sendMagicLink(email) {
  if (!hasCloud) return { ok: false, error: 'Cloud sync is not configured in this build.' };

  const trimmed = String(email ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Enter your email address.' };

  const { error } = await getSupabase().auth.signInWithOtp({
    email: trimmed,
    options: { emailRedirectTo: redirectTarget() },
  });

  if (error) {
    // "Failed to fetch" is what a blocked or absent network surfaces as; say
    // something a person can act on instead.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline || /failed to fetch|network/i.test(error.message)) {
      return {
        ok: false,
        error: 'Could not reach the server. Check your connection and try again.',
      };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function signOut() {
  if (!hasCloud) return;
  await getSupabase().auth.signOut();
}

export async function getSession() {
  if (!hasCloud) return null;
  const { data } = await getSupabase().auth.getSession();
  return data?.session ?? null;
}

/**
 * Subscribe to sign-in/sign-out. Fires immediately with the current session so
 * callers do not have to separately prime themselves.
 */
export function onAuthChange(handler) {
  if (!hasCloud) {
    handler(null);
    return () => {};
  }

  getSession().then(handler);
  const { data } = getSupabase().auth.onAuthStateChange((_event, session) =>
    handler(session ?? null),
  );
  return () => data?.subscription?.unsubscribe();
}

/**
 * Strip the PKCE `?code=` (and any `error=`) parameters after supabase-js has
 * consumed them, so a refresh does not retry a spent code and the address bar
 * is not left full of auth noise.
 */
export function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const hadAuthParams = ['code', 'error', 'error_description'].some((k) =>
    url.searchParams.has(k),
  );
  if (!hadAuthParams) return false;

  for (const key of ['code', 'error', 'error_description']) url.searchParams.delete(key);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash || '#/'}`);
  return true;
}
