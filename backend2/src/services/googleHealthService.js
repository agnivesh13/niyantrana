/**
 * Turns Google Health API responses into wearable days this service can score.
 *
 * The model consumes six features per day, and each comes from a different
 * corner of the API:
 *
 *   daily_steps             steps, daily roll-up
 *   active_minutes          active-minutes roll-up, or active-zone-minutes
 *   sleep_hours             sleep sessions, summed from stages
 *   sleep_quality_score     sleep sessions, efficiency computed from stages
 *   resting_heart_rate      daily-resting-heart-rate, listed
 *   heart_rate_variability  daily-heart-rate-variability, listed
 *
 * **Why extraction is tolerant.** The published reference names some value
 * fields exactly (`steps.count`, `dailyRestingHeartRate.beatsPerMinute`,
 * `dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds`) and
 * describes others only as "interval data", while stating that roll-up fields
 * "usually follow the format {original_field_name}_{aggregation_function}". So
 * each feature declares candidate paths and the first numeric hit wins.
 *
 * **Why that is not sloppiness.** A field that cannot be found stays `null`,
 * never 0 — the gradient-boosting estimators handle a missing value natively,
 * and a fabricated zero would be read as "did not move" or "did not sleep".
 * Every sync returns a report naming the path it resolved for each feature and
 * how many days it covered, so a contract change surfaces as a visible gap
 * rather than as quietly wrong data.
 */
import googleHealthClient, { GoogleHealthAuthError, civilDate } from '../clients/googleHealthClient.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import userRepository from '../repositories/userRepository.js';

const DEFAULT_DAYS = 90;
const MAX_DAYS = 365;
const SOURCE = 'google_health';

/** Refresh a little early rather than racing the expiry. */
const EXPIRY_SKEW_MS = 60000;

const number = (value) => {
  if (value === null || value === undefined || value === '') return null;
  // int64 fields arrive as strings in JSON, e.g. steps.countSum: "3822".
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
};

const at = (object, path) => path.split('.')
  .reduce((node, key) => (node === null || node === undefined ? undefined : node[key]), object);

/** First candidate path that yields a finite number, with the path used. */
function resolve(object, candidates) {
  for (const path of candidates) {
    const value = number(at(object, path));
    if (value !== null) return { value, path };
  }
  return { value: null, path: null };
}

/**
 * Interval feature specs.
 *
 * `dataType` is the URL segment; `candidates` are roll-up value paths in
 * decreasing order of confidence. `fallback` is a different data type to try
 * when the first yields nothing at all — active minutes is the case that needs
 * it, because Active Zone Minutes is the metric Google actually documents a
 * field name for, and is the modern equivalent of the fairly-plus-very-active
 * minutes this project originally used.
 */
const ROLLUP_FEATURES = [
  {
    field: 'daily_steps',
    dataType: 'steps',
    candidates: ['steps.countSum', 'steps.count', 'steps.sum'],
  },
  {
    field: 'active_minutes',
    dataType: 'active-minutes',
    candidates: [
      'activeMinutes.minutesSum', 'activeMinutes.activeMinutesSum',
      'activeMinutes.countSum', 'activeMinutes.durationMinutesSum',
      'activeMinutes.minutes', 'activeMinutes.count',
    ],
    fallback: {
      dataType: 'active-zone-minutes',
      candidates: [
        'activeZoneMinutes.activeZoneMinutesSum', 'activeZoneMinutes.countSum',
        'activeZoneMinutes.activeZoneMinutes',
      ],
    },
  },
];

/** Daily-record feature specs, read with list rather than roll-up. */
const DAILY_FEATURES = [
  {
    field: 'resting_heart_rate',
    dataType: 'daily-resting-heart-rate',
    // Documented exactly.
    candidates: ['dailyRestingHeartRate.beatsPerMinute'],
    valueField: 'dailyRestingHeartRate',
    /**
     * Fall back to the daily MINIMUM of intraday heart rate.
     *
     * `daily-resting-heart-rate` is a value Fitbit's backend derives overnight.
     * A Samsung Health account feeds raw samples into Google Health and no such
     * daily record is produced, so the field is empty while the phone quite
     * visibly shows heart-rate data -- it is simply a different data type.
     *
     * The daily minimum is a defensible proxy for resting pulse, and it is the
     * quantity the model was fitted on (NHANES measures a resting pulse).
     * **Average is deliberately not accepted**: mean daily heart rate is a
     * different physiological quantity, and feeding it to a feature named
     * `resting_heart_rate` would be wrong in a way no error would reveal.
     */
    rollupFallback: {
      dataType: 'heart-rate',
      candidates: [
        'heartRate.beatsPerMinuteMin', 'heartRate.minimum', 'heartRate.min',
        'heartRate.beatsPerMinuteMinimum', 'heartRate.restingBeatsPerMinute',
      ],
      derived: 'daily minimum of intraday heart rate',
    },
  },
  {
    field: 'heart_rate_variability',
    dataType: 'daily-heart-rate-variability',
    /**
     * Deep-sleep RMSSD first, on purpose.
     *
     * The feature was trained against Fitbit's `dailyRmssd`, which is measured
     * during sleep. The daily average is a different statistic over a different
     * window, so preferring it would change what the feature means without
     * changing its name.
     */
    candidates: [
      'dailyHeartRateVariability.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds',
      'dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds',
    ],
    valueField: 'dailyHeartRateVariability',
    /**
     * Fall back to intraday HRV samples, averaged per day.
     *
     * Same cause as resting heart rate: the daily record is a derivation the
     * Fitbit backend performs, while a Samsung source supplies samples. The
     * intraday type carries RMSSD in milliseconds, which is the same statistic
     * the feature was trained on -- only over a different window, and the report
     * says so.
     */
    listFallback: {
      dataType: 'heart-rate-variability',
      valueField: 'heartRateVariability',
      candidates: [
        'heartRateVariability.rmssd.value',
        'heartRateVariability.rootMeanSquareOfSuccessiveDifferencesMilliseconds',
        'heartRateVariability.rmssd',
      ],
      aggregate: 'mean',
      derived: 'daily mean of intraday RMSSD samples',
    },
  },
];

/** Time-filter expressions to try, most specific first. */
const filterCandidatesFor = (valueField) => [
  (from, to) => `${valueField}.interval.civil_start_time >= "${from}" AND `
    + `${valueField}.interval.civil_start_time <= "${to}"`,
  (from, to) => `${valueField}.sample_time.civil_time >= "${from}" AND `
    + `${valueField}.sample_time.civil_time <= "${to}"`,
];

const CIVIL_TIME_PATHS = [
  'interval.civilStartTime', 'sampleTime.civilTime', 'civilStartTime', 'civilTime',
];
const PHYSICAL_TIME_PATHS = [
  'interval.startTime', 'sampleTime.physicalTime', 'startTime',
];

/** Civil date from one node, or null. */
function civilDateIn(node) {
  if (!node) return null;
  for (const path of CIVIL_TIME_PATHS) {
    const civil = at(node, path);
    if (civil?.date?.year) {
      const { year, month, day } = civil.date;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  for (const path of PHYSICAL_TIME_PATHS) {
    const stamp = at(node, path);
    if (stamp) return civilDate(stamp);
  }
  return null;
}

/**
 * The civil date a data point belongs to.
 *
 * Checked on the data point AND inside its value object, because the timestamp
 * sits in different places depending on the record kind: a roll-up carries
 * `civilStartTime` at the top level, while a sample nests its time inside the
 * value — the published vitals example is
 * `{ heartRateVariability: { sampleTime: {...}, rmssd: {...} } }`. Searching
 * only the top level silently found no date and dropped every sleep session and
 * daily record.
 */
function dateOf(point, valueField) {
  return civilDateIn(point) ?? civilDateIn(valueField ? point?.[valueField] : null);
}

const TIME_KEYS = new Set([
  'civilStartTime', 'civilEndTime', 'sampleTime', 'interval', 'name', 'dataSource',
  'createTime', 'updateTime', 'startTime', 'endTime',
]);

/**
 * The value fields a response actually carried.
 *
 * "No value found at any known field path" says the mapping missed; it does not
 * say what to map to. Reporting the observed keys turns one more sync into the
 * answer, which matters because the published reference names some of these
 * fields and describes others only as "interval data" -- so the real response is
 * the only authority.
 */
function observedFields(points, limit = 3) {
  const seen = new Set();
  for (const point of points.slice(0, limit)) {
    for (const [key, value] of Object.entries(point ?? {})) {
      if (TIME_KEYS.has(key)) continue;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const sub of Object.keys(value)) {
          if (!TIME_KEYS.has(sub)) seen.add(`${key}.${sub}`);
        }
      } else {
        seen.add(key);
      }
    }
  }
  return [...seen].slice(0, 12);
}

export class GoogleHealthService {
  constructor({ client = googleHealthClient, users = userRepository } = {}) {
    this.client = client;
    this.users = users;
  }

  get configured() {
    return this.client.configured;
  }

  authorizationUrl(state) {
    return this.client.authorizationUrl(state);
  }

  /** Store tokens after the consent callback. */
  async connect(userId, code) {
    const tokens = await this.client.exchangeCode(code);
    if (!tokens.refreshToken) {
      // Without one, access dies in an hour and cannot be renewed. Better to
      // refuse the connection than to record one that will quietly expire.
      throw new ValidationError(
        'Google did not return a refresh token. Remove this app from your Google '
        + 'account permissions and connect again.',
      );
    }

    let googleUserId;
    try {
      const identity = await this.client.identity(tokens.accessToken);
      googleUserId = identity.googleUserId ?? identity.userId ?? identity.fitbitUserId;
    } catch {
      // Identity is a nicety; the connection is usable without it.
      googleUserId = undefined;
    }

    await this.users.saveGoogleHealthTokens(userId, {
      ...tokens,
      googleUserId,
      connectedAt: new Date(),
    });
    return { connected: true, scopes: tokens.scopes };
  }

  async disconnect(userId) {
    await this.users.clearGoogleHealth(userId);
    return { connected: false, historyKept: true };
  }

  async status(userId) {
    const user = await this.users.googleHealthTokens(userId);
    if (!user) throw new NotFoundError('User');
    const connection = user.googleHealth;
    // A stored refresh token that Google has rejected is not a connection.
    // Showing "Connected" beside one is the same class of lie as a fabricated
    // score: the UI asserting something the server knows to be false.
    const needsReconnect = Boolean(connection?.needsReconnect);
    return {
      configured: this.configured,
      connected: Boolean(connection?.refreshToken) && !needsReconnect,
      needsReconnect,
      scopes: connection?.scopes ?? [],
      connectedAt: connection?.connectedAt ?? null,
      lastSyncedAt: connection?.lastSyncedAt ?? null,
    };
  }

  /** A valid access token, refreshed and persisted if it has expired. */
  async #accessToken(userId) {
    const user = await this.users.googleHealthTokens(userId);
    const connection = user?.googleHealth;
    if (!connection?.refreshToken) {
      throw new GoogleHealthAuthError('Connect your Google account first');
    }

    const expiry = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
    if (connection.accessToken && expiry - EXPIRY_SKEW_MS > Date.now()) {
      return connection.accessToken;
    }

    let refreshed;
    try {
      refreshed = await this.client.refresh(connection.refreshToken);
    } catch (error) {
      // Only a grant Google has actually rejected marks the connection dead. A
      // timeout leaves it alone, because the tokens may well still be good.
      if (error.revoked) {
        await this.users.saveGoogleHealthTokens(userId, { needsReconnect: true });
      }
      throw error;
    }

    await this.users.saveGoogleHealthTokens(userId, {
      ...refreshed,
      needsReconnect: false,
    });
    return refreshed.accessToken;
  }

  /**
   * Pull `days` of history and merge it into the user's wearable history.
   *
   * Upserted by date, so re-syncing an overlapping range refreshes those days
   * rather than duplicating them — which would corrupt the 14-day window the
   * model reads.
   */
  async sync(userId, { days = DEFAULT_DAYS } = {}) {
    const span = Math.min(Math.max(Number(days) || DEFAULT_DAYS, 1), MAX_DAYS);
    const accessToken = await this.#accessToken(userId);

    const end = new Date();
    const start = new Date(end.getTime() - (span - 1) * 86400000);

    const byDate = new Map();
    const report = {};

    const record = (date, field, value) => {
      if (!date || value === null) return;
      const day = byDate.get(date) ?? { date, source: SOURCE };
      day[field] = value;
      byDate.set(date, day);
    };

    for (const feature of ROLLUP_FEATURES) {
      report[feature.field] = await this.#collectRollUp(
        accessToken, feature, start, end, record);
    }

    for (const feature of DAILY_FEATURES) {
      let entry = await this.#collectDaily(accessToken, feature, start, end, record);

      // The daily record is a Fitbit-backend derivation. When the account
      // supplies raw samples instead -- as a Samsung Health source does -- the
      // same quantity has to be derived here, from the intraday type.
      if (entry.days === 0 && feature.rollupFallback) {
        const fallback = await this.#collectRollUp(
          accessToken,
          { field: feature.field, ...feature.rollupFallback },
          start, end, record,
        );
        if (fallback.days > 0) {
          entry = { ...fallback, derived: feature.rollupFallback.derived };
        }
      }
      if (entry.days === 0 && feature.listFallback) {
        const fallback = await this.#collectSamples(
          accessToken, feature.field, feature.listFallback, start, end, record);
        if (fallback.days > 0) entry = fallback;
      }

      report[feature.field] = entry;
    }

    report.sleep = await this.#collectSleep(accessToken, start, end, record);

    const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

    /**
     * One cause, said once.
     *
     * `ACCOUNT_NOT_LINKED` is the single most likely outcome for a user outside
     * the Fitbit ecosystem, and it is not a fault in the request: the Google
     * Health API serves data from a Fitbit-linked Google account and from
     * nothing else. Data held in Google Fit, Health Connect or Samsung Health
     * is a different store the API cannot reach. Repeating the raw rejection
     * once per feature reads as six failures instead of one fact.
     */
    const notLinked = Object.values(report)
      .some((entry) => entry?.code === 'ACCOUNT_NOT_LINKED');

    if (!entries.length) {
      return {
        imported: 0,
        report,
        accountNotLinked: notLinked,
        notice: notLinked
          ? 'This Google account has no linked Fitbit account, and the Google Health API '
            + 'only serves Fitbit-linked accounts. Data in Google Fit, Health Connect or '
            + 'Samsung Health is a separate store it cannot read. Import a file export '
            + 'instead -- that path reads all of them.'
          : 'Google Health returned no data for this period. If the account has no '
            + 'paired device, add data in the Google Health app or import a file export.',
      };
    }

    const merge = await this.users.upsertWatchData(userId, entries);
    await this.users.saveGoogleHealthTokens(userId, { lastSyncedAt: new Date() });

    return {
      imported: entries.length,
      ...merge,
      range: { from: entries[0].date, to: entries[entries.length - 1].date },
      source: SOURCE,
      report,
    };
  }

  async #collectRollUp(accessToken, feature, start, end, record) {
    const attempts = [
      { dataType: feature.dataType, candidates: feature.candidates },
      ...(feature.fallback ? [feature.fallback] : []),
    ];
    const diagnostics = [];

    for (const attempt of attempts) {
      let points;
      try {
        points = await this.client.dailyRollUp(accessToken, attempt.dataType, start, end);
      } catch (error) {
        if (error instanceof GoogleHealthAuthError) throw error;
        // A data type this account cannot serve is a gap, not a failure: the
        // remaining five features are still worth collecting.
        return {
          days: 0,
          dataType: attempt.dataType,
          error: error.message,
          code: error.details?.code,
        };
      }

      let days = 0;
      let resolvedPath = null;
      for (const point of points) {
        const { value, path } = resolve(point, attempt.candidates);
        if (value === null) continue;
        resolvedPath = resolvedPath ?? path;
        record(dateOf(point), feature.field, value);
        days += 1;
      }
      if (days > 0) return { days, dataType: attempt.dataType, path: resolvedPath };

      // Points came back but none held a number at a path we know. Record what
      // they DID hold, so the mapping can be corrected from evidence.
      if (points.length) {
        diagnostics.push({
          dataType: attempt.dataType,
          points: points.length,
          observed: observedFields(points),
        });
      } else {
        diagnostics.push({ dataType: attempt.dataType, points: 0 });
      }
    }

    return {
      days: 0,
      dataType: feature.dataType,
      error: diagnostics.some((d) => d.points > 0)
        ? 'no value found at any known field path'
        : 'the API returned no data points for this type',
      diagnostics,
    };
  }

  async #collectDaily(accessToken, feature, start, end, record) {
    const { valueField } = feature;
    let result;
    try {
      result = await this.client.listDataPoints(accessToken, feature.dataType, start, end, {
        filterCandidates: filterCandidatesFor(
          valueField.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)),
      });
    } catch (error) {
      if (error instanceof GoogleHealthAuthError) throw error;
      return {
        days: 0,
        dataType: feature.dataType,
        error: error.message,
        code: error.details?.code,
      };
    }

    const from = civilDate(start);
    const to = civilDate(end);
    let days = 0;
    let resolvedPath = null;
    for (const point of result.points) {
      const date = dateOf(point, valueField);
      // When every filter was rejected the API returned the whole history, so
      // the range is enforced here instead.
      if (!date || date < from || date > to) continue;
      const { value, path } = resolve(point, feature.candidates);
      if (value === null) continue;
      resolvedPath = resolvedPath ?? path;
      record(date, feature.field, value);
      days += 1;
    }

    return {
      days,
      dataType: feature.dataType,
      path: resolvedPath,
      filtered: Boolean(result.filter),
      // Distinguishes "this account has no such data" from "we looked in the
      // wrong place". Both show as zero days; only one is ours to fix.
      ...(days === 0 && {
        points: result.points.length,
        observed: observedFields(result.points),
        error: result.points.length
          ? 'no value found at any known field path'
          : 'the API returned no data points for this type',
      }),
    };
  }

  /**
   * Intraday samples, aggregated into one value per day.
   *
   * Used when a daily record the API would normally derive is absent. The
   * aggregation is named in the report so the number is never mistaken for the
   * platform's own daily figure -- it is ours, computed from samples, and the
   * difference matters when comparing against a Fitbit-sourced account.
   */
  async #collectSamples(accessToken, field, spec, start, end, record) {
    let result;
    try {
      result = await this.client.listDataPoints(accessToken, spec.dataType, start, end, {
        filterCandidates: filterCandidatesFor(
          spec.valueField.replace(/([A-Z])/g, (m) => `_${m.toLowerCase()}`)),
      });
    } catch (error) {
      if (error instanceof GoogleHealthAuthError) throw error;
      return { days: 0, dataType: spec.dataType, error: error.message };
    }

    const from = civilDate(start);
    const to = civilDate(end);
    const perDay = new Map();
    let resolvedPath = null;

    for (const point of result.points) {
      const date = dateOf(point, spec.valueField);
      if (!date || date < from || date > to) continue;
      const { value, path } = resolve(point, spec.candidates);
      if (value === null) continue;
      resolvedPath = resolvedPath ?? path;
      const bucket = perDay.get(date) ?? [];
      bucket.push(value);
      perDay.set(date, bucket);
    }

    for (const [date, values] of perDay) {
      const aggregated = spec.aggregate === 'min'
        ? Math.min(...values)
        : values.reduce((total, value) => total + value, 0) / values.length;
      record(date, field, Number(aggregated.toFixed(2)));
    }

    return {
      days: perDay.size,
      dataType: spec.dataType,
      path: resolvedPath,
      derived: spec.derived,
      ...(perDay.size === 0 && {
        points: result.points.length,
        observed: observedFields(result.points),
      }),
    };
  }

  /**
   * Sleep, assembled from sessions.
   *
   * There is no sleep roll-up and no pre-computed efficiency field, so both
   * features are derived here using the formula the API documentation itself
   * states: round(minutes asleep / minutes in bed * 100). Awake stages are
   * subtracted; a session with no stage breakdown contributes its duration to
   * hours and no efficiency at all, rather than a fabricated 100.
   */
  async #collectSleep(accessToken, start, end, record) {
    let result;
    try {
      result = await this.client.listDataPoints(accessToken, 'sleep', start, end, {
        filterCandidates: filterCandidatesFor('sleep'),
      });
    } catch (error) {
      if (error instanceof GoogleHealthAuthError) throw error;
      return {
        days: 0,
        dataType: 'sleep',
        error: error.message,
        code: error.details?.code,
      };
    }

    const from = civilDate(start);
    const to = civilDate(end);
    const perDay = new Map();

    for (const point of result.points) {
      const session = point.sleep ?? point;
      const date = dateOf(point, 'sleep');
      if (!date || date < from || date > to) continue;

      const startTime = at(session, 'interval.startTime') ?? session.startTime;
      const endTime = at(session, 'interval.endTime') ?? session.endTime;
      if (!startTime || !endTime) continue;

      const inBedMinutes = (new Date(endTime) - new Date(startTime)) / 60000;
      if (!(inBedMinutes > 0)) continue;

      const stages = session.stages ?? session.sleepStages ?? [];
      const awakeMinutes = stages
        .filter((stage) => String(stage.type).toUpperCase() === 'AWAKE')
        .reduce((total, stage) => total
          + (new Date(stage.endTime) - new Date(stage.startTime)) / 60000, 0);

      const tally = perDay.get(date) ?? { inBed: 0, asleep: 0, staged: false };
      tally.inBed += inBedMinutes;
      tally.asleep += Math.max(inBedMinutes - awakeMinutes, 0);
      tally.staged = tally.staged || stages.length > 0;
      perDay.set(date, tally);
    }

    for (const [date, tally] of perDay) {
      record(date, 'sleep_hours', Number((tally.asleep / 60).toFixed(2)));
      if (tally.staged && tally.inBed > 0) {
        record(date, 'sleep_quality_score',
          Math.min(Math.round((tally.asleep / tally.inBed) * 100), 100));
      }
    }

    return {
      days: perDay.size,
      dataType: 'sleep',
      derived: 'hours from stages; efficiency = asleep / in bed',
      filtered: Boolean(result.filter),
      ...(perDay.size === 0 && {
        points: result.points.length,
        observed: observedFields(result.points),
      }),
    };
  }
}

export default new GoogleHealthService();
