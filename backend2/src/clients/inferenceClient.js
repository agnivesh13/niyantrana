/**
 * Adapter over the Python inference service.
 *
 * Patterns applied: Adapter (translates between this service's vocabulary and
 * the model service's wire format) and Remove Middle Man (the route no longer
 * reaches through to axios itself).
 *
 * The behaviour this replaces is the single worst defect in v1: apiRoutes.js
 * wrapped the ML call in a try/catch that, on ANY failure, substituted
 * `TG: 150 + Math.random() * 50` and returned HTTP 200. There were three such
 * fallbacks. A caller had no way to distinguish a real prediction from a random
 * number, in a health application.
 *
 * This client throws. It never invents a value.
 */
import axios from 'axios';

import config from '../config/env.js';
import { InferenceUnavailableError, ValidationError } from '../domain/errors.js';

/** A monitoring probe has to answer quickly or be treated as down. */
const HEALTH_PROBE_TIMEOUT_MS = 5000;

/**
 * A path that exists only to be requested.
 *
 * Any HTTP status -- 404 included -- proves the container is listening, which
 * is the only thing a wake-up call needs to establish. `/health` cannot serve
 * that purpose: it runs a functional probe that loads the model stack and
 * scores a profile, so on a cold start it answers only after boot AND import
 * AND a 7 MB joblib load. Waiting for readiness when you only need aliveness is
 * what made a woken container look like a failed wake.
 */
const WAKE_PATH = '/__wake';

/** Once the container is up, readiness is a short question. */
const WARM_PROBE_TIMEOUT_MS = 20000;

export class InferenceClient {
  constructor({ baseUrl = config.inferenceServiceUrl,
                timeout = config.inferenceTimeoutMs,
                coldStartTimeout = config.inferenceColdStartTimeoutMs,
                http = axios } = {}) {
    this.baseUrl = InferenceClient.normalizeBaseUrl(baseUrl);
    this.timeout = timeout;
    this.coldStartTimeout = coldStartTimeout;
    this.http = http;
  }

  /**
   * Accept a bare hostname as well as a full URL.
   *
   * Render blueprints wire services together with `fromService` +
   * `property: host`, which yields `niyantrana-inference.onrender.com` with no
   * scheme. Without this, every request would be built as
   * `niyantrana-inference.onrender.com/predict` and fail to parse -- so the
   * blueprint could not connect the two services without manual editing.
   */
  static normalizeBaseUrl(value) {
    const trimmed = String(value || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    // A bare host is assumed to be TLS-terminated, except on localhost.
    const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(trimmed)
      ? 'http' : 'https';
    return `${scheme}://${trimmed}`;
  }

  /**
   * Whether a failure looks like the model service being asleep rather than
   * broken. Only these are worth a second, longer attempt.
   */
  static #isColdStart(error) {
    if (error.response) return false;          // it answered, so it is awake
    return ['ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
      'EAI_AGAIN'].includes(error.code);
  }

  async #send(path, payload, timeout) {
    const response = await this.http.post(`${this.baseUrl}${path}`, payload, {
      timeout,
      headers: { 'Content-Type': 'application/json' },
    });
    return response.data;
  }

  async #post(path, payload) {
    try {
      return await this.#send(path, payload, this.timeout);
    } catch (error) {
      // A 4xx means we sent something invalid; surface it as a client error
      // rather than blaming the downstream service.
      const status = error.response?.status;
      if (status >= 400 && status < 500) {
        throw new ValidationError(
          error.response.data?.detail || 'The inference service rejected the request',
          error.response.data,
        );
      }

      // Retry ONCE, and only for a failure that looks like a sleeping service.
      // A 5xx is not retried: the service answered, so repeating the call just
      // doubles the latency before reporting the same fault.
      if (!InferenceClient.#isColdStart(error) || this.coldStartTimeout <= this.timeout) {
        throw new InferenceUnavailableError(error.code || error.message);
      }

      console.warn(`[inference] ${error.code || error.message}; retrying once with `
        + `${this.coldStartTimeout}ms in case the service is waking from idle`);
      try {
        return await this.#send(path, payload, this.coldStartTimeout);
      } catch (retryError) {
        throw new InferenceUnavailableError(
          `${retryError.code || retryError.message} (after a cold-start retry)`);
      }
    }
  }

  /**
   * Returns a full risk assessment, or throws. Never a fabricated score.
   *
   * `history` is what makes trajectories possible. The inference service has
   * accepted it since the trajectory feature was built, but this client did not
   * send it -- so every response came back with an empty `trajectories` array
   * and the risk-over-time feature was unreachable through the API. Caught by
   * the demo-seeding test asserting that 90 days of history yields trends.
   */
  async assessRisk({ profile, wearableWindow, history, measured }) {
    const data = await this.#post('/predict', {
      user_data: profile,
      watch_data: wearableWindow,
      history: history?.length ? history : undefined,
      measured: measured || null,
    });

    if (!data || !Array.isArray(data.risks) || !data.provenance) {
      // v1 responded to an unrecognised shape by substituting random numbers.
      throw new InferenceUnavailableError('Malformed response from inference service');
    }
    return data;
  }

  async recommendMeal({ userContext, meal }) {
    return this.#post('/recommend', { user_context: userContext, original_meal: meal });
  }

  /**
   * Liveness, and optionally a wake-up call.
   *
   * Two timeouts, because this endpoint serves two purposes that want opposite
   * things. A monitoring probe must answer fast: 5 seconds, fail and move on.
   * A wake-up call must *hold the connection open* while a spun-down container
   * starts, which measured 34.9 seconds in production — so a 5-second probe
   * aborts roughly seven times too early and reports the service as unreachable
   * at precisely the moment it is booting.
   *
   * That was the bug behind "the model is not answering, but it answered when
   * you ran curl": curl held the request open for two minutes, the browser gave
   * up after five seconds, and nothing in the UI tried again.
   */
  /**
   * Knock on the door and wait for any answer.
   *
   * Deliberately accepts every status code: a 404 from the wake path means
   * uvicorn is serving, which is exactly what is being asked.
   */
  async #knock() {
    try {
      await this.http.get(`${this.baseUrl}${WAKE_PATH}`, {
        timeout: this.coldStartTimeout,
        validateStatus: () => true,
      });
      return true;
    } catch {
      return false;
    }
  }

  async health({ wake = false } = {}) {
    // Waking is two questions, not one: is the container listening, and are the
    // models loaded. Conflating them meant a container that had woken but was
    // still loading counted as a failed wake, and the caller gave up on a
    // service that was seconds from ready.
    const awake = wake ? await this.#knock() : undefined;
    const timeout = wake ? WARM_PROBE_TIMEOUT_MS : HEALTH_PROBE_TIMEOUT_MS;

    // The URL is always reported. Diagnosing the production ENOTFOUND took an
    // extra round trip purely because this returned {reachable:false, reason}
    // without saying which address it had tried.
    try {
      const { data } = await this.http.get(`${this.baseUrl}/health`, { timeout });
      return { reachable: true, url: this.baseUrl, waited: wake, awake, ...data };
    } catch (error) {
      return {
        reachable: false,
        url: this.baseUrl,
        reason: error.code || error.message,
        waited: wake,
        awake,
        // Up, but still loading its models. The caller should go ahead and ask
        // for a prediction rather than count this as a failure -- /predict has
        // its own cold-start budget and the container is already running.
        warming: Boolean(awake),
        hint: error.code === 'ENOTFOUND'
          ? 'The hostname does not resolve. On Render, `fromService property: host` '
            + 'yields a PRIVATE network name, which free web services cannot reach. '
            + 'Set ML_SERVICE_URL to the public https:// URL.'
          : undefined,
      };
    }
  }
}

export default new InferenceClient();
