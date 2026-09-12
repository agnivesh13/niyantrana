/**
 * HTTP adapters for wearable import and demo seeding.
 *
 * Import is the primary wearable path. Every consumer API a solo developer
 * could use has closed to new registrations (see wearableImportService.js), so
 * a file export is the only route that cannot be deprecated out from under the
 * project -- and it needs no device, which matters when the reviewer of a
 * portfolio project owns none.
 */
import crypto from 'node:crypto';

import config from '../config/env.js';
import { UnauthorizedError, ValidationError } from '../domain/errors.js';
import demoDataService from '../services/demoDataService.js';
import googleHealthService from '../services/googleHealthService.js';
import userRepository from '../repositories/userRepository.js';
import WearableImportService, { FIELD_ALIASES } from '../services/wearableImportService.js';

const MAX_IMPORT_DAYS = 400;

export async function importWearableData(req, res) {
  // Accept a raw CSV/JSON body, or a JSON envelope carrying the payload.
  const isEnvelope = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
    && (req.body.data !== undefined || req.body.payload !== undefined);
  const payload = isEnvelope ? (req.body.data ?? req.body.payload) : req.body;
  const source = (isEnvelope ? req.body.source : req.query.source) || 'import';

  const { days, skipped } = WearableImportService.parse(payload, source);
  if (days.length > MAX_IMPORT_DAYS) {
    throw new ValidationError(`Import is limited to ${MAX_IMPORT_DAYS} days per request`, {
      received: days.length,
    });
  }

  const result = await userRepository.upsertWatchData(req.user.id, days);
  res.status(201).json({
    imported: days.length,
    skipped,
    source,
    ...result,
    range: { from: days[0].date, to: days[days.length - 1].date },
  });
}

export async function loadDemoData(req, res) {
  const days = Number(req.body?.days) || 90;
  const trend = req.body?.trend || 'improving';
  const result = await demoDataService.seed(req.user.id, { days, trend });
  res.status(201).json(result);
}

export function importFormats(_req, res) {
  res.json({
    accepts: ['text/csv', 'application/json'],
    sources: ['google_health', 'fitbit', 'apple_health', 'oura', 'withings',
      'google_takeout', 'import', 'manual'],
    canonicalFields: Object.keys(FIELD_ALIASES).filter((f) => f !== 'sleep_minutes'),
    fieldAliases: FIELD_ALIASES,
    note: 'Send CSV text, a JSON array of daily records, or a per-metric object '
      + '({ steps: [{dateTime, value}], ... }) as produced by Google Takeout. '
      + 'Column names are matched against a wide alias list, so most exports '
      + 'import without transformation.',
  });
}

// --- Google Health ----------------------------------------------------------

export function googleHealthStatus(req, res) {
  return googleHealthService.status(req.user.id).then((status) => res.json(status));
}

/**
 * Begin the consent flow.
 *
 * `state` is a random value held in the session and checked on return. Without
 * it, a third party could hand the user a callback URL carrying their own
 * authorization code and attach their health account to this user.
 */
export async function googleHealthStart(req, res) {
  if (!googleHealthService.configured) {
    throw new ValidationError(
      'Google Health is not configured on this server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)',
    );
  }
  const state = crypto.randomBytes(32).toString('base64url');
  req.session.googleHealthState = state;
  res.redirect(googleHealthService.authorizationUrl(state));
}

/**
 * Consent callback.
 *
 * Redirects back to the app with the outcome in the query string rather than
 * rendering here: this endpoint is reached by a browser navigation from Google,
 * not by the client, so JSON would leave the user looking at raw output.
 */
export async function googleHealthCallback(req, res) {
  const expected = req.session.googleHealthState;
  delete req.session.googleHealthState;

  const returnTo = config.google.healthReturnUrl || `${config.corsOrigins[0]}/onboarding`;
  const back = (params) => res.redirect(`${returnTo}?${new URLSearchParams(params)}`);

  if (req.query.error) return back({ google_health: 'denied', reason: req.query.error });
  if (!req.query.state || req.query.state !== expected) {
    throw new UnauthorizedError('That Google callback did not match this session');
  }
  if (!req.query.code) return back({ google_health: 'denied', reason: 'no_code' });

  const result = await googleHealthService.connect(req.user.id, req.query.code);
  return back({ google_health: 'connected', scopes: result.scopes.length });
}

export async function googleHealthSync(req, res) {
  const days = Number(req.body?.days) || undefined;
  res.json(await googleHealthService.sync(req.user.id, { days }));
}

export async function googleHealthDisconnect(req, res) {
  res.json(await googleHealthService.disconnect(req.user.id));
}
