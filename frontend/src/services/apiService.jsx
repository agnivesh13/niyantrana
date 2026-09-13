/**
 * The single place this app talks to its API.
 *
 * Auth is session cookies, not bearer tokens, so every request sends
 * `credentials: 'include'` and no token is stored client-side. Failures throw
 * `ApiError` carrying the real status: nothing is substituted on failure, which
 * is what lets a screen tell "the model is down" apart from "you have no data
 * yet" and say so.
 */

/**
 * Empty by default, which means same-origin.
 *
 * In development that routes through the Vite proxy, so the browser and the API
 * share an origin and the session cookie needs no cross-site handling at all.
 * In production the two are on different hosts, so VITE_API_BASE_URL is set and
 * the API answers with `SameSite=None; Secure`.
 *
 * Only ever a URL. Anything VITE_-prefixed is inlined into the bundle and is
 * therefore public, so no secret can live behind one.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (networkError) {
    throw new ApiError(
      `Cannot reach the API at ${API_BASE || window.location.origin}`, 0, networkError.message);
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // Surfaced with its real status. Nothing is substituted on failure -- the
    // whole point of this rewrite.
    throw new ApiError(payload?.message || `Request failed (${response.status})`,
      response.status, payload?.details);
  }
  return payload;
}

export const auth = {
  register: (email, password) => request('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),

  /**
   * Exchange a Google Identity Services credential for a session.
   *
   * The credential is an ID token that only Google can have signed; the server
   * verifies it against Google's public keys. Nothing here is trusted client
   * side, which is why the browser never decodes it.
   */
  google: (credential) => request('/auth/google', { method: 'POST', body: { credential } }),
};

export const user = {
  status: () => request('/api/user/status'),
  saveProfile: (profile) => request('/api/user/profile', { method: 'POST', body: profile }),
  updateWeight: (weight) => request('/api/user/weight', { method: 'POST', body: { weight } }),
  wearable: (days = 14) => request(`/api/user/wearable?days=${days}`),

  /**
   * Delete the account and everything attached to it. Irreversible.
   *
   * `confirm` must be the account's own email address; the server checks it and
   * refuses otherwise, so a mis-click cannot reach the delete.
   */
  deleteAccount: (confirm) =>
    request('/api/user/account', { method: 'DELETE', body: { confirm } }),
};

export const logs = {
  meals: (limit = 50) => request(`/api/logs/meals?limit=${limit}`),
  logMeal: (meal) => request('/api/logs/meals', { method: 'POST', body: meal }),
  dailyMacros: () => request('/api/logs/macros/daily'),
  logVitals: (reading) => request('/api/logs/vitals', { method: 'POST', body: reading }),
  vitals: () => request('/api/logs/vitals'),
  logActivity: (activity) => request('/api/logs/activity', { method: 'POST', body: activity }),
  searchFood: (query) => request(`/api/food/search?q=${encodeURIComponent(query)}`),
};

export const risk = {
  /**
   * Multi-condition assessment.
   *
   * Every score in the response carries `provenance` and `basis`. If the
   * inference service is unreachable this throws with status 503 -- it never
   * returns a plausible-looking number.
   */
  assess: () => request('/api/predict', { method: 'POST', body: {} }),
  recommendMeal: (meal) => request('/api/recommend', { method: 'POST', body: { meal } }),

  /** Reachability of the inference service. Unauthenticated, fails fast. */
  inferenceHealth: () => request('/api/inference/health'),

  /**
   * Wake the inference service, and wait for it.
   *
   * `?wake=1` makes the API hold the request open for its cold-start window
   * rather than the 5-second probe window. The distinction matters: a spun-down
   * container takes around 35 seconds to answer, so a probe that gives up at 5
   * reports it unreachable while it is still starting.
   */
  wakeInference: () => request('/api/inference/health?wake=1'),
};

export const wearable = {
  formats: () => request('/api/wearable/formats'),
  import: (data, source = 'import') => request('/api/wearable/import', { method: 'POST', body: { data, source } }),
  /**
   * Seed demo history. `force` confirms overwriting real data.
   *
   * Without it the server refuses when the account holds wearable days that did
   * not come from a previous demo, rather than replacing them silently.
   */
  loadDemo: (days = 90, { force = false } = {}) =>
    request('/api/wearable/demo', { method: 'POST', body: { days, force } }),

  /**
   * Import a Samsung Health export.
   *
   * Takes the extracted CSVs verbatim. Every value is derived server-side, so
   * the browser's only jobs are unzipping and trimming by date.
   */
  importSamsung: (files) =>
    request('/api/wearable/import/samsung', { method: 'POST', body: { files } }),

  // --- Google Health ---
  googleHealthStatus: () => request('/api/wearable/google-health'),
  googleHealthSync: (days = 90) =>
    request('/api/wearable/google-health/sync', { method: 'POST', body: { days } }),
  googleHealthDisconnect: () =>
    request('/api/wearable/google-health', { method: 'DELETE' }),

  /**
   * Where to send the browser to grant Google Health access.
   *
   * A full navigation rather than a fetch: the flow redirects to Google and
   * back, which an XHR cannot follow. Absolute, because in production the API
   * is on a different host from this bundle.
   */
  googleHealthConnectUrl: () => `${API_BASE}/auth/google/health`,
};

export const chat = {
  send: (message, history = []) => request('/api/chat', { method: 'POST', body: { message, history } }),
};

export default { auth, user, logs, risk, wearable, chat, API_BASE };
