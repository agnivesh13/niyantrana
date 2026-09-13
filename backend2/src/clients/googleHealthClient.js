/**
 * Adapter over the Google Health API.
 *
 * This is the successor to the Fitbit Web API, which is turned down in
 * September 2026, and to the Google Fit APIs, which closed to new developer
 * sign-ups on 1 May 2024 and are deprecated in 2026. It is the only live,
 * first-party route from a Google or Fitbit account to this service.
 *
 * Two properties of the API shape this class:
 *
 * 1. **Query ranges are capped per data type.** 14 days for active-minutes,
 *    heart-rate and total-calories; 90 days for everything else. A 90-day
 *    backfill therefore has to be chunked, and the chunk size depends on which
 *    data type is being read.
 *
 * 2. **Aggregation differs by record kind.** Steps and active minutes are
 *    interval data with a daily roll-up endpoint. Sleep is a *session*, so a
 *    day's sleep has to be assembled from stages. Resting heart rate and HRV
 *    are *daily records*, listed rather than rolled up.
 *
 * Reference: https://developers.google.com/health/endpoints
 *
 * This client throws rather than substituting values, for the same reason the
 * inference client does: a fabricated health number is worse than an error.
 */
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';

import config from '../config/env.js';
import { AppError, ValidationError } from '../domain/errors.js';

const API_BASE = 'https://health.googleapis.com/v4';
const DEFAULT_TIMEOUT_MS = 20000;

/** Documented maximum query range, in days, by data type. */
const MAX_RANGE_DAYS = 90;
const NARROW_RANGE_TYPES = new Set([
  'active-minutes', 'heart-rate', 'total-calories', 'calories-in-heart-rate-zone',
]);
const NARROW_RANGE_DAYS = 14;

/** `pageSize` ceilings the API documents. Sessions are far lower than samples. */
const PAGE_SIZE = { sleep: 25, exercise: 25, default: 1000 };
const MAX_PAGES = 20;

export class GoogleHealthUnavailableError extends AppError {
  constructor(detail) {
    super(`The Google Health API did not answer: ${detail}`, 503);
    this.provenance = 'unavailable';
  }
}

export class GoogleHealthAuthError extends AppError {
  /**
   * `revoked` separates "this grant is dead" from "this request failed".
   *
   * The two want opposite responses: a revoked grant should stop the UI
   * claiming a working connection, while a network blip should change nothing
   * and be retried. Treating them alike either strands the user on a dead
   * "Connected" badge or disconnects them over a hiccup.
   */
  constructor(message = 'Reconnect your Google account to refresh access', { revoked = false } = {}) {
    super(message, 401);
    this.revoked = revoked;
  }
}

const pad = (value) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` in UTC. Civil dates in this API are plain calendar dates. */
export const civilDate = (date) => {
  const at = date instanceof Date ? date : new Date(date);
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
};

/** The API takes civil date-times as structured objects, not strings. */
const civilDateTime = (date, endOfDay = false) => {
  const at = date instanceof Date ? date : new Date(date);
  return {
    date: {
      year: at.getUTCFullYear(),
      month: at.getUTCMonth() + 1,
      day: at.getUTCDate(),
    },
    time: endOfDay
      ? { hours: 23, minutes: 59, seconds: 59 }
      : { hours: 0, minutes: 0, seconds: 0 },
  };
};

const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

/**
 * Split a range into chunks the API will accept.
 *
 * Without this a 90-day backfill of active minutes fails wholesale on the 14-day
 * cap, which is the kind of error that reads as "the integration is broken".
 */
export function chunkRange(start, end, maxDays) {
  const chunks = [];
  let from = new Date(start);
  const last = new Date(end);
  while (from <= last) {
    const to = new Date(Math.min(addDays(from, maxDays - 1).getTime(), last.getTime()));
    chunks.push({ start: from, end: to });
    from = addDays(to, 1);
  }
  return chunks;
}

export class GoogleHealthClient {
  constructor({
    clientId = config.google.clientId,
    clientSecret = config.google.clientSecret,
    redirectUri = config.google.healthRedirectUri,
    scopes = config.google.healthScopes,
    http = axios,
    timeout = DEFAULT_TIMEOUT_MS,
  } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
    this.scopes = scopes;
    this.http = http;
    this.timeout = timeout;
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  #oauth() {
    if (!this.configured) {
      throw new ValidationError(
        'Google Health is not configured: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET',
      );
    }
    return new OAuth2Client(this.clientId, this.clientSecret, this.redirectUri);
  }

  /**
   * Consent URL.
   *
   * `access_type: offline` with `prompt: consent` is what yields a refresh
   * token. Without both, a re-authorising user gets an access token only, and
   * the nightly sync silently stops working an hour later.
   */
  authorizationUrl(state) {
    return this.#oauth().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      // `include_granted_scopes` is deliberately NOT set.
      //
      // It folds every scope the user has ever granted this OAuth client into
      // the new token. Where a client has previously held the legacy Google Fit
      // scopes, those return in the token and collide with the Health API
      // authorization layer, producing a 403 on data reads while identity and
      // profile reads keep working. Requesting exactly the three scopes this
      // client reads avoids the collision entirely.
      scope: this.scopes,
      state,
    });
  }

  /** Exchange the one-time code for tokens. */
  async exchangeCode(code) {
    try {
      const { tokens } = await this.#oauth().getToken(code);
      return GoogleHealthClient.#normalizeTokens(tokens);
    } catch (error) {
      throw new GoogleHealthAuthError(
        `Google refused the authorization code: ${error.message}`,
      );
    }
  }

  /** Trade a refresh token for a fresh access token. */
  async refresh(refreshToken) {
    if (!refreshToken) throw new GoogleHealthAuthError();
    const client = this.#oauth();
    client.setCredentials({ refresh_token: refreshToken });
    try {
      await client.getAccessToken();
      return GoogleHealthClient.#normalizeTokens({
        ...client.credentials,
        refresh_token: client.credentials.refresh_token || refreshToken,
      });
    } catch (error) {
      // `invalid_grant` is Google saying the refresh token is no longer valid:
      // the user revoked access, or -- while the app is in Testing mode --
      // Google expired it, which it does after 7 days. Permanent either way;
      // retrying forever would just log the same failure every sync.
      const revoked = /invalid_grant|invalid_token|unauthorized_client/i
        .test(`${error.message} ${error.response?.data?.error ?? ''}`);
      throw new GoogleHealthAuthError(
        `Google would not refresh the token (${error.message}). Reconnect the account.`,
        { revoked },
      );
    }
  }

  static #normalizeTokens(tokens) {
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: (tokens.scope || '').split(' ').filter(Boolean),
    };
  }

  static maxRangeDays(dataType) {
    return NARROW_RANGE_TYPES.has(dataType) ? NARROW_RANGE_DAYS : MAX_RANGE_DAYS;
  }

  async #request(accessToken, { method, path, body, params }) {
    try {
      const response = await this.http.request({
        method,
        url: `${API_BASE}${path}`,
        params,
        data: body,
        timeout: this.timeout,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (error) {
      const status = error.response?.status;
      if (status === 401) throw new GoogleHealthAuthError();
      if (status === 403) {
        // Distinct from 401: the token is valid but this scope was not granted,
        // which is a consent problem the user has to resolve, not a token one.
        throw new GoogleHealthAuthError(
          'Google Health refused this data type. The scope may not have been granted.',
        );
      }
      if (status >= 400 && status < 500) {
        const body = error.response?.data?.error ?? {};
        const detail = body.message || error.message;

        // ACCOUNT_NOT_LINKED is not a fault in the request: it means this
        // Google account has no Fitbit account behind it, and the Health API
        // serves nothing else. Flagged so the caller can say that once, clearly,
        // instead of repeating an opaque rejection for all six features.
        const notLinked = body.status === 'ACCOUNT_NOT_LINKED'
          || /not linked/i.test(detail);

        throw new ValidationError(`Google Health rejected the request: ${detail}`, {
          status,
          path,
          code: notLinked ? 'ACCOUNT_NOT_LINKED' : body.status,
        });
      }
      throw new GoogleHealthUnavailableError(error.code || error.message);
    }
  }

  /**
   * Daily totals for an interval data type, e.g. steps.
   *
   * Returns the raw roll-up points; interpreting their value fields is the
   * service layer's job, because which sub-field carries the number varies by
   * data type and the published reference does not name all of them.
   */
  async dailyRollUp(accessToken, dataType, start, end) {
    const points = [];
    for (const chunk of chunkRange(start, end, GoogleHealthClient.maxRangeDays(dataType))) {
      let pageToken;
      let pages = 0;
      do {
        const data = await this.#request(accessToken, {
          method: 'POST',
          path: `/users/me/dataTypes/${dataType}/dataPoints:dailyRollUp`,
          body: {
            range: {
              start: civilDateTime(chunk.start),
              end: civilDateTime(chunk.end, true),
            },
            windowSizeDays: 1,
            pageToken,
          },
        });
        points.push(...(data.rollupDataPoints ?? []));
        pageToken = data.nextPageToken;
        pages += 1;
      } while (pageToken && pages < MAX_PAGES);
    }
    return points;
  }

  /**
   * Individual data points for a session or daily record type.
   *
   * The time filter follows AIP-160 and is rooted at the data type's own value
   * field, e.g. `sleep.interval.civil_start_time >= "2026-06-01"`. Candidate
   * expressions are tried in turn because the reference documents this shape
   * for interval types but not for daily records, and a wrong filter is a 400
   * rather than an empty result. If every candidate is rejected the range is
   * dropped and the points are filtered in this process instead — slower, but
   * it returns real data rather than an error caused by a guess.
   */
  async listDataPoints(accessToken, dataType, start, end, { filterCandidates = [] } = {}) {
    const pageSize = PAGE_SIZE[dataType] ?? PAGE_SIZE.default;
    const attempts = [...filterCandidates, null];
    let lastRejection;

    for (const buildFilter of attempts) {
      const params = { pageSize };
      if (buildFilter) params.filter = buildFilter(civilDate(start), civilDate(end));

      try {
        const points = [];
        let pageToken;
        let pages = 0;
        do {
          const data = await this.#request(accessToken, {
            method: 'GET',
            path: `/users/me/dataTypes/${dataType}/dataPoints`,
            params: { ...params, pageToken },
          });
          points.push(...(data.dataPoints ?? []));
          pageToken = data.nextPageToken;
          pages += 1;
        } while (pageToken && pages < MAX_PAGES);

        return { points, filter: params.filter ?? null };
      } catch (error) {
        // Only a rejected filter is worth another attempt. An auth failure or an
        // outage would fail identically every time.
        if (!(error instanceof ValidationError)) throw error;
        lastRejection = error;
      }
    }

    throw lastRejection;
  }

  /** The connected account, used to recognise a reconnection. */
  async identity(accessToken) {
    const data = await this.#request(accessToken, {
      method: 'GET',
      path: '/users/me/identity',
    });
    return data ?? {};
  }
}

export default new GoogleHealthClient();
