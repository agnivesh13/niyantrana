/**
 * Centralised, validated environment configuration.
 *
 * Refactoring applied: Extract Class + Replace Magic Number with Symbolic Constant.
 *
 * Previously `process.env` was read at four unrelated call sites, the port was
 * the literal 8080 hardcoded in server.js, CORS was the literal
 * 'http://localhost:5173', and the session secret silently fell back to
 * 'a secret key for the hackathon'. Configuration is now resolved once, here,
 * and a production boot fails loudly rather than running insecurely.
 */
import dotenv from 'dotenv';

dotenv.config();

const bool = (value, fallback = false) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

const isProduction = process.env.NODE_ENV === 'production';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction,
  port: Number(process.env.PORT) || 8080,

  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/niyantrana',

  sessionSecret: process.env.SESSION_SECRET,
  sessionMaxAgeMs: Number(process.env.SESSION_MAX_AGE_MS) || 24 * 60 * 60 * 1000,

  // Comma-separated list so preview deployments can be allowed without a redeploy.
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map((o) => o.trim()).filter(Boolean),

  inferenceServiceUrl: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  inferenceTimeoutMs: Number(process.env.ML_TIMEOUT_MS) || 15000,
  // A free-tier instance spins down after 15 minutes idle and takes roughly a
  // minute to wake. The normal 15s timeout fires long before that, so the first
  // request after an idle period would always fail. One retry with a much
  // longer window turns a guaranteed failure into a slow success.
  inferenceColdStartTimeoutMs: Number(process.env.ML_COLD_START_TIMEOUT_MS) || 75000,

  geminiApiKey: process.env.GEMINI_API_KEY,

  /**
   * Google identity and the Google Health API.
   *
   * Replaces the Fitbit block that was here. Fitbit's Web API is turned down in
   * September 2026 and the Google Health API is its declared successor, so a
   * Fitbit OAuth seam was config for something that cannot be registered for.
   * Fitbit remains a supported *import* source -- a file export needs no API.
   *
   * `clientId` is not a secret. It is sent to the browser by design, which is
   * why the frontend has its own VITE_GOOGLE_CLIENT_ID. The secret is only ever
   * used here, server-side, for the authorization-code exchange.
   */
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    // Where Google returns the user after they grant health access. Must match
    // an Authorised redirect URI on the OAuth client, exactly.
    healthRedirectUri: process.env.GOOGLE_HEALTH_REDIRECT_URI
      || 'http://localhost:8080/auth/google/health/callback',
    // Where to send the browser once tokens are stored.
    healthReturnUrl: process.env.GOOGLE_HEALTH_RETURN_URL,
    /**
     * Read-only Health API scopes.
     *
     * Overridable because the published scope-to-data-type mapping does not
     * state which scope covers daily resting heart rate and HRV, and requesting
     * a scope you do not need is exactly what an OAuth review rejects. Narrow
     * this once the consent screen shows what each one grants.
     */
    healthScopes: (process.env.GOOGLE_HEALTH_SCOPES
      || ['https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
        'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
        'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
      ].join(',')).split(',').map((scope) => scope.trim()).filter(Boolean),
  },

  trustProxy: bool(process.env.TRUST_PROXY, isProduction),
};

/**
 * Fail fast on misconfiguration rather than booting into an insecure state.
 * The v1 server started happily with a known-public session secret.
 */
export function assertValidConfig() {
  const problems = [];

  if (!config.sessionSecret) {
    problems.push('SESSION_SECRET is required');
  } else if (config.sessionSecret.length < 16) {
    problems.push('SESSION_SECRET must be at least 16 characters');
  }

  if (config.isProduction) {
    if (config.corsOrigins.includes('*')) problems.push('CORS_ORIGIN must not be * in production');
    if (config.mongoUri.includes('localhost')) problems.push('MONGO_URI still points at localhost');
  }

  if (problems.length) {
    throw new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return config;
}

export default config;
