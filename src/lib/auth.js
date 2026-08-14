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
 * Read the auth parameters out of the current URL, from wherever they landed.
 *
 * They can land in two places, and the second one defeats supabase-js's own
 * parser. Its helper does:
 *
 *     new URLSearchParams(url.hash.substring(1))
 *
 * which is right for the implicit flow's `#access_token=…&expires_in=…`, but
 * this app is a HashRouter app whose redirect target ends in `#/`. Append a
 * query to that and you get `…/MikeMaxing/#/?code=abc`, whose hash minus the
 * leading `#` is `/?code=abc` — parsed as a single parameter NAMED `/?code`.
 * The code is right there in the URL and supabase cannot see it.
 *
 * So: split the hash at its first `?` and parse only what follows.
 */
export function readAuthParamsFromUrl(href = window.location.href) {
  const url = new URL(href);

  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
  const fromHash = new URLSearchParams(hashQuery);

  // Search wins over hash, matching supabase's own precedence.
  const get = (key) => url.searchParams.get(key) ?? fromHash.get(key);

  return {
    code: get('code'),
    error: get('error'),
    errorDescription: get('error_description'),
    get present() {
      return Boolean(this.code || this.error);
    },
  };
}

/**
 * Strip the PKCE `?code=` (and any `error=`) parameters, so a refresh does not
 * retry a spent code and the address bar is not left full of auth noise.
 *
 * Must run AFTER the exchange. See initAuth.
 */
export function cleanAuthParamsFromUrl() {
  const url = new URL(window.location.href);
  const keys = ['code', 'error', 'error_description'];

  let changed = false;
  for (const key of keys) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  // Clean the hash too — a code that arrived as `#/?code=…` would otherwise
  // survive and be retried, spent, on the next load.
  let hash = url.hash;
  if (hash.includes('?')) {
    const [route, query] = [hash.slice(0, hash.indexOf('?')), hash.slice(hash.indexOf('?') + 1)];
    const params = new URLSearchParams(query);
    for (const key of keys) {
      if (params.has(key)) {
        params.delete(key);
        changed = true;
      }
    }
    const rest = params.toString();
    hash = rest ? `${route}?${rest}` : route;
  }

  if (!changed) return false;
  window.history.replaceState({}, '', `${url.pathname}${url.search}${hash || '#/'}`);
  return true;
}

/**
 * Establish the session from a magic-link landing, then tidy the URL.
 *
 * The order here is the entire point, and getting it backwards is what broke
 * sign-in completely. supabase-js reads the URL exactly once, inside
 * `_initialize()`, which runs when the client is CONSTRUCTED. Our client is
 * lazy — `getSupabase()` builds it on first use, which was the fix for a CI
 * crash — so "construct the client" is not something that happens on its own
 * at import. startSync() called cleanAuthParamsFromUrl() first, on the theory
 * that supabase had already consumed the code. With a lazy client it had not:
 * the very first thing the app did on landing from the magic link was delete
 * the `?code=` it needed, and only then build the client that would have
 * exchanged it. No session, no error, every time.
 *
 * So: construct first, let the exchange finish, and only then clean up.
 */
export async function initAuth() {
  if (!hasCloud) return { session: null, error: null, attempted: false };

  const params = readAuthParamsFromUrl();

  // Construct FIRST, unconditionally, before anything in this function can
  // touch the URL. _initialize() parses window.location as it builds, so the
  // client must exist while the parameters are still there. Nothing below may
  // clean the URL ahead of this line.
  const supabase = getSupabase();

  // The provider can report a failure instead of a code — an expired or
  // already-used link, most often. That is worth surfacing rather than
  // silently rendering a signed-out screen.
  if (params.error) {
    cleanAuthParamsFromUrl();
    return {
      session: null,
      error: params.errorDescription || params.error,
      attempted: true,
    };
  }

  // getSession() awaits initializePromise, so this waits for the exchange
  // rather than racing it.
  let session = null;
  try {
    const { data } = await supabase.auth.getSession();
    session = data?.session ?? null;
  } catch {
    /* fall through to the explicit exchange below */
  }

  // Belt and braces for the hash case above: if a code is still sitting in the
  // URL unconsumed, supabase did not recognise it, so exchange it ourselves.
  if (!session && params.code) {
    try {
      const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) {
        cleanAuthParamsFromUrl();
        return { session: null, error: error.message, attempted: true };
      }
      session = data?.session ?? null;
    } catch (err) {
      cleanAuthParamsFromUrl();
      return { session: null, error: err?.message ?? 'Sign-in link could not be used.', attempted: true };
    }
  }

  cleanAuthParamsFromUrl();

  return {
    session,
    error:
      params.code && !session
        ? 'The sign-in link did not produce a session. Links can only be used once — request a new one.'
        : null,
    attempted: params.present,
  };
}
