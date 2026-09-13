/**
 * Google sign-in and Google Health API tests.
 *
 * Unit tests with injected doubles, so unlike the other suites these need no
 * MongoDB and no inference service — which matters here, because the Google
 * Health API cannot be called from CI at all: every scope is Restricted, so a
 * real token requires a consenting account added as a test user in the Google
 * Cloud console.
 *
 * What that makes these tests responsible for: the mapping. The published
 * reference names some value fields exactly and describes others only as
 * "interval data", so the adapter resolves each feature against candidate
 * paths. These tests pin the documented names, pin the fallback order, and —
 * most importantly — pin that a field which cannot be found stays absent
 * rather than becoming a zero. A zero here would read as "did not move" or
 * "did not sleep" and would be fed straight to the model.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

process.env.SESSION_SECRET ??= 'google-test-secret-key-long-enough';

const { AuthService } = await import('../src/services/authService.js');
const { GoogleHealthService } = await import('../src/services/googleHealthService.js');
const { GoogleHealthClient, chunkRange, civilDate } = await import('../src/clients/googleHealthClient.js');
const { UnauthorizedError, ValidationError } = await import('../src/domain/errors.js');

/* ------------------------------------------------------------- test doubles */

/** Minimal in-memory user store with the seams the services actually use. */
function fakeUsers(seed = []) {
  const rows = seed.map((row, index) => ({ id: row.id ?? `u${index}`, ...row }));
  return {
    rows,
    findByGoogleId: async (googleId) => rows.find((r) => r.googleId === googleId) ?? null,
    findByEmail: async (email) => rows.find((r) => r.email === email) ?? null,
    linkGoogleId: async (id, googleId) => {
      const row = rows.find((r) => r.id === id);
      row.googleId = googleId;
      return row;
    },
    create: async (attributes) => {
      const row = { id: `u${rows.length}`, ...attributes };
      rows.push(row);
      return row;
    },
    googleHealthTokens: async (id) => rows.find((r) => r.id === id) ?? null,
    saveGoogleHealthTokens: async (id, tokens) => {
      const row = rows.find((r) => r.id === id);
      row.googleHealth = { ...row.googleHealth, ...tokens };
      return row;
    },
    clearGoogleHealth: async (id) => {
      const row = rows.find((r) => r.id === id);
      delete row.googleHealth;
      return row;
    },
    upsertWatchData: async (id, entries) => {
      const row = rows.find((r) => r.id === id);
      row.watchHistory = entries;
      return { added: entries.length, updated: 0, total: entries.length };
    },
  };
}

const verifier = (payload, { fail = false } = {}) => ({
  verifyIdToken: async () => {
    if (fail) throw new Error('Invalid token signature');
    return { getPayload: () => payload };
  },
});

const ONE_DAY = 86400000;
const dayOffset = (days) => new Date(Date.now() - days * ONE_DAY);

/** A rollup point as the API returns one: int64 values arrive as strings. */
const rollup = (date, body) => ({
  civilStartTime: {
    date: {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    },
    time: { hours: 0, minutes: 0, seconds: 0 },
  },
  ...body,
});

/**
 * A daily record as the API returns one.
 *
 * The sample time is nested INSIDE the value object, matching the published
 * vitals example `{ heartRateVariability: { sampleTime: {...}, rmssd: {...} } }`.
 * A fixture with the timestamp at the top level would have passed against code
 * that cannot read the real response.
 */
const dailyPoint = (date, valueField, value) => ({
  [valueField]: {
    sampleTime: {
      civilTime: {
        date: {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
        },
      },
    },
    ...value,
  },
});

/**
 * A stub Health client. `streams` maps data type to the points it serves;
 * anything absent returns nothing, which is what an account without that
 * metric does.
 */
function fakeClient(streams = {}, { onRefresh } = {}) {
  const calls = [];
  return {
    calls,
    configured: true,
    authorizationUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchangeCode: async () => ({
      accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3600000),
      scopes: ['activity_and_fitness.readonly'],
    }),
    refresh: async () => {
      onRefresh?.();
      return {
        accessToken: 'refreshed', refreshToken: 'refresh',
        expiresAt: new Date(Date.now() + 3600000), scopes: [],
      };
    },
    identity: async () => ({ googleUserId: 'g-123' }),
    dailyRollUp: async (_token, dataType) => {
      calls.push(`rollUp:${dataType}`);
      const stream = streams[dataType];
      if (stream instanceof Error) throw stream;
      return stream ?? [];
    },
    listDataPoints: async (_token, dataType) => {
      calls.push(`list:${dataType}`);
      const stream = streams[dataType];
      if (stream instanceof Error) throw stream;
      return { points: stream ?? [], filter: 'applied' };
    },
  };
}

const connectedUser = () => fakeUsers([{
  id: 'u0',
  email: 'someone@example.com',
  googleHealth: {
    refreshToken: 'refresh',
    accessToken: 'access',
    expiresAt: new Date(Date.now() + 3600000),
  },
}]);

/* ------------------------------------------------------------- sign-in tests */

describe('Google sign-in', () => {
  const payload = { sub: 'google-sub-1', email: 'New.User@Example.com', email_verified: true };

  it('refuses a missing credential', async () => {
    const service = new AuthService(fakeUsers(), { googleClientId: 'cid' });
    await assert.rejects(() => service.signInWithGoogle(undefined), ValidationError);
  });

  it('refuses when Google sign-in is not configured', async () => {
    const service = new AuthService(fakeUsers(), { googleClientId: undefined });
    await assert.rejects(() => service.signInWithGoogle('token'), ValidationError);
  });

  it('refuses a token the verifier rejects', async () => {
    const service = new AuthService(fakeUsers(), {
      googleClientId: 'cid',
      googleVerifier: verifier(payload, { fail: true }),
    });
    // The whole point: a hand-made JWT must not authenticate anyone.
    await assert.rejects(() => service.signInWithGoogle('forged'), UnauthorizedError);
  });

  it('refuses an unverified Google email', async () => {
    const service = new AuthService(fakeUsers(), {
      googleClientId: 'cid',
      googleVerifier: verifier({ ...payload, email_verified: false }),
    });
    await assert.rejects(() => service.signInWithGoogle('token'), UnauthorizedError);
  });

  it('creates a lower-cased account with no password', async () => {
    const users = fakeUsers();
    const service = new AuthService(users, {
      googleClientId: 'cid', googleVerifier: verifier(payload),
    });

    const user = await service.signInWithGoogle('token');
    assert.equal(user.email, 'new.user@example.com');
    assert.equal(user.googleId, 'google-sub-1');
    assert.equal(user.password, undefined, 'no password should be invented');
  });

  it('returns the same account on a second sign-in', async () => {
    const users = fakeUsers([{ id: 'u0', email: 'a@b.com', googleId: 'google-sub-1' }]);
    const service = new AuthService(users, {
      googleClientId: 'cid', googleVerifier: verifier(payload),
    });

    const user = await service.signInWithGoogle('token');
    assert.equal(user.id, 'u0');
    assert.equal(users.rows.length, 1, 'must not create a duplicate account');
  });

  it('links Google to an existing password account with the same email', async () => {
    const users = fakeUsers([
      { id: 'u0', email: 'new.user@example.com', password: 'hashed' },
    ]);
    const service = new AuthService(users, {
      googleClientId: 'cid', googleVerifier: verifier(payload),
    });

    const user = await service.signInWithGoogle('token');
    assert.equal(user.id, 'u0', 'should not orphan the existing account and its history');
    assert.equal(user.googleId, 'google-sub-1');
    assert.equal(users.rows.length, 1);
  });

  it('treats a passwordless account as invalid credentials, not a crash', async () => {
    // bcrypt.compare(password, undefined) rejects, so without the guard a
    // password attempt against a Google-only account would 500.
    const users = {
      findByEmail: () => ({ select: () => ({ id: 'u0', email: 'g@x.com' }) }),
    };
    const service = new AuthService(users, { googleClientId: 'cid' });
    assert.equal(await service.verifyCredentials('g@x.com', 'anything'), null);
  });
});

/* --------------------------------------------------------------- client tests */

describe('Google Health client', () => {
  it('caps the query range per data type, as the API documents', () => {
    assert.equal(GoogleHealthClient.maxRangeDays('active-minutes'), 14);
    assert.equal(GoogleHealthClient.maxRangeDays('heart-rate'), 14);
    assert.equal(GoogleHealthClient.maxRangeDays('steps'), 90);
    assert.equal(GoogleHealthClient.maxRangeDays('sleep'), 90);
  });

  it('splits a 90-day backfill into contiguous 14-day chunks', () => {
    const end = new Date('2026-09-13T00:00:00Z');
    const start = new Date(end.getTime() - 89 * ONE_DAY);
    const chunks = chunkRange(start, end, 14);

    assert.equal(chunks.length, 7);
    assert.equal(civilDate(chunks[0].start), civilDate(start));
    assert.equal(civilDate(chunks.at(-1).end), civilDate(end));

    // No gaps and no overlaps: every chunk starts the day after the last ended.
    for (let i = 1; i < chunks.length; i += 1) {
      const expected = new Date(chunks[i - 1].end.getTime() + ONE_DAY);
      assert.equal(civilDate(chunks[i].start), civilDate(expected));
    }
    for (const chunk of chunks) {
      const span = (chunk.end - chunk.start) / ONE_DAY + 1;
      assert.ok(span <= 14, `chunk of ${span} days exceeds the documented cap`);
    }
  });

  it('reports itself unconfigured without credentials', () => {
    assert.equal(new GoogleHealthClient({ clientId: '', clientSecret: '' }).configured, false);
    assert.equal(new GoogleHealthClient({ clientId: 'a', clientSecret: 'b' }).configured, true);
  });
});

/* -------------------------------------------------------------- mapping tests */

describe('Google Health sync', () => {
  it('maps the documented step field, parsing int64 strings', async () => {
    const day = dayOffset(1);
    const client = fakeClient({
      steps: [rollup(day, { steps: { countSum: '8432' } })],
    });
    const users = connectedUser();
    const result = await new GoogleHealthService({ client, users }).sync('u0', { days: 7 });

    assert.equal(result.imported, 1);
    assert.equal(users.rows[0].watchHistory[0].daily_steps, 8432);
    assert.equal(result.report.daily_steps.path, 'steps.countSum');
    assert.equal(users.rows[0].watchHistory[0].source, 'google_health');
  });

  it('falls back to active-zone-minutes when active-minutes yields nothing', async () => {
    const day = dayOffset(1);
    const client = fakeClient({
      'active-minutes': [],
      'active-zone-minutes': [rollup(day, { activeZoneMinutes: { activeZoneMinutesSum: '46' } })],
    });
    const users = connectedUser();
    const result = await new GoogleHealthService({ client, users }).sync('u0', { days: 7 });

    assert.equal(users.rows[0].watchHistory[0].active_minutes, 46);
    assert.equal(result.report.active_minutes.dataType, 'active-zone-minutes');
  });

  it('prefers deep-sleep RMSSD over the daily average for HRV', async () => {
    const day = dayOffset(1);
    const client = fakeClient({
      'daily-heart-rate-variability': [dailyPoint(day, 'dailyHeartRateVariability', {
        averageHeartRateVariabilityMilliseconds: 31.5,
        deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 44.2,
      })],
      'daily-resting-heart-rate': [dailyPoint(day, 'dailyRestingHeartRate', {
        beatsPerMinute: '58',
      })],
    });
    const users = connectedUser();
    const result = await new GoogleHealthService({ client, users }).sync('u0', { days: 7 });

    const [entry] = users.rows[0].watchHistory;
    // The feature was trained against sleep-window RMSSD; the daily average is
    // a different statistic and would silently change what the feature means.
    assert.equal(entry.heart_rate_variability, 44.2);
    assert.equal(entry.resting_heart_rate, 58);
    assert.match(result.report.heart_rate_variability.path, /deepSleep/);
  });

  it('derives sleep hours and efficiency from stages, excluding awake time', async () => {
    const night = new Date('2026-09-12T00:00:00Z');
    const session = {
      interval: {
        startTime: '2026-09-11T22:00:00Z',
        endTime: '2026-09-12T06:00:00Z',      // 480 minutes in bed
        civilStartTime: {
          date: { year: 2026, month: 9, day: 12 },
        },
      },
      stages: [
        { startTime: '2026-09-11T22:00:00Z', endTime: '2026-09-12T00:00:00Z', type: 'LIGHT' },
        { startTime: '2026-09-12T00:00:00Z', endTime: '2026-09-12T00:30:00Z', type: 'AWAKE' },
        { startTime: '2026-09-12T00:30:00Z', endTime: '2026-09-12T06:00:00Z', type: 'DEEP' },
      ],
    };
    const client = fakeClient({ sleep: [{ sleep: session }] });
    const users = connectedUser();
    const service = new GoogleHealthService({ client, users });

    // Sync a window wide enough to include the fixed date above.
    const days = Math.ceil((Date.now() - night.getTime()) / ONE_DAY) + 2;
    await service.sync('u0', { days });

    const entry = users.rows[0].watchHistory.find((d) => d.date === '2026-09-12');
    assert.ok(entry, 'the session should land on its civil date');
    assert.equal(entry.sleep_hours, 7.5);               // 480 - 30 awake = 450 min
    assert.equal(entry.sleep_quality_score, 94);        // round(450 / 480 * 100)
  });

  it('omits sleep efficiency rather than inventing 100 when there are no stages', async () => {
    const client = fakeClient({
      sleep: [{
        sleep: {
          interval: {
            startTime: '2026-09-11T23:00:00Z',
            endTime: '2026-09-12T06:00:00Z',
            civilStartTime: { date: { year: 2026, month: 9, day: 12 } },
          },
          stages: [],
        },
      }],
    });
    const users = connectedUser();
    const days = Math.ceil((Date.now() - new Date('2026-09-12T00:00:00Z').getTime()) / ONE_DAY) + 2;
    await new GoogleHealthService({ client, users }).sync('u0', { days });

    const entry = users.rows[0].watchHistory.find((d) => d.date === '2026-09-12');
    assert.equal(entry.sleep_hours, 7);
    assert.equal('sleep_quality_score' in entry, false,
      'an unknown efficiency must be absent, not a fabricated number');
  });

  it('leaves unavailable features absent instead of zero', async () => {
    const day = dayOffset(1);
    const client = fakeClient({ steps: [rollup(day, { steps: { countSum: '5000' } })] });
    const users = connectedUser();
    await new GoogleHealthService({ client, users }).sync('u0', { days: 7 });

    const [entry] = users.rows[0].watchHistory;
    for (const field of ['active_minutes', 'sleep_hours', 'resting_heart_rate',
      'heart_rate_variability']) {
      assert.equal(field in entry, false, `${field} must be absent, never 0`);
    }
  });

  it('keeps collecting other features when one data type fails', async () => {
    const day = dayOffset(1);
    const client = fakeClient({
      steps: [rollup(day, { steps: { countSum: '7000' } })],
      'daily-resting-heart-rate': new ValidationError('unsupported data type'),
    });
    const users = connectedUser();
    const result = await new GoogleHealthService({ client, users }).sync('u0', { days: 7 });

    assert.equal(users.rows[0].watchHistory[0].daily_steps, 7000);
    assert.equal(result.report.resting_heart_rate.days, 0);
    assert.match(result.report.resting_heart_rate.error, /unsupported/);
  });

  it('reports an empty account as empty, with an explanation', async () => {
    const users = connectedUser();
    const result = await new GoogleHealthService({ client: fakeClient(), users })
      .sync('u0', { days: 7 });

    assert.equal(result.imported, 0);
    assert.match(result.notice, /no data/i);
    assert.equal(users.rows[0].watchHistory, undefined, 'nothing should be written');
  });

  it('refreshes an expired access token and stores the new one', async () => {
    let refreshed = 0;
    const client = fakeClient(
      { steps: [rollup(dayOffset(1), { steps: { countSum: '1000' } })] },
      { onRefresh: () => { refreshed += 1; } },
    );
    const users = fakeUsers([{
      id: 'u0',
      googleHealth: {
        refreshToken: 'refresh',
        accessToken: 'stale',
        expiresAt: new Date(Date.now() - 1000),   // already expired
      },
    }]);

    await new GoogleHealthService({ client, users }).sync('u0', { days: 7 });
    assert.equal(refreshed, 1);
    assert.equal(users.rows[0].googleHealth.accessToken, 'refreshed');
  });

  it('refuses to sync an unconnected account', async () => {
    const users = fakeUsers([{ id: 'u0', email: 'a@b.com' }]);
    await assert.rejects(
      () => new GoogleHealthService({ client: fakeClient(), users }).sync('u0'),
      (error) => error.statusCode === 401,
    );
  });

  it('keeps imported history when disconnecting', async () => {
    const users = connectedUser();
    users.rows[0].watchHistory = [{ date: '2026-09-01', daily_steps: 100 }];
    const result = await new GoogleHealthService({ client: fakeClient(), users })
      .disconnect('u0');

    assert.equal(result.connected, false);
    assert.equal(users.rows[0].googleHealth, undefined);
    assert.equal(users.rows[0].watchHistory.length, 1, 'the user own data is not deleted');
  });

  it('reports connection status without leaking tokens', async () => {
    const users = connectedUser();
    users.rows[0].googleHealth.scopes = ['sleep.readonly'];
    const status = await new GoogleHealthService({ client: fakeClient(), users }).status('u0');

    assert.equal(status.connected, true);
    assert.deepEqual(status.scopes, ['sleep.readonly']);
    assert.equal('accessToken' in status, false);
    assert.equal('refreshToken' in status, false);
  });
});

/* ------------------------------------------------- inference wake-up tests */

const { InferenceClient } = await import('../src/clients/inferenceClient.js');

describe('Inference wake-up call', () => {
  /** Records the timeout each request was given. */
  const spyHttp = (behaviour) => {
    const timeouts = [];
    return {
      timeouts,
      get: async (_url, options) => {
        timeouts.push(options.timeout);
        return behaviour(options);
      },
    };
  };

  it('probes with a short timeout by default', async () => {
    const http = spyHttp(() => ({ data: { status: 'ok' } }));
    const client = new InferenceClient({ baseUrl: 'http://ml.test', http });

    const health = await client.health();
    assert.equal(health.reachable, true);
    assert.equal(http.timeouts[0], 5000, 'a monitoring probe must fail fast');
    assert.equal(health.waited, false);
  });

  it('holds the connection for the cold-start window when waking', async () => {
    const http = spyHttp(() => ({ data: { status: 'ok' } }));
    const client = new InferenceClient({
      baseUrl: 'http://ml.test',
      http,
      coldStartTimeout: 75000,
    });

    const health = await client.health({ wake: true });
    assert.equal(health.waited, true);
    // The regression this pins: a 5s wake-up cannot survive a cold start that
    // measured 34.9s in production, so it reported the service unreachable at
    // exactly the moment it was booting.
    assert.equal(http.timeouts[0], 75000);
    assert.ok(http.timeouts[0] > 34900, 'must outlast a measured cold start');
  });

  it('reports unreachable without throwing, and says which URL it tried', async () => {
    const http = spyHttp(() => { throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }); });
    const client = new InferenceClient({ baseUrl: 'http://ml.test', http });

    const health = await client.health({ wake: true });
    assert.equal(health.reachable, false);
    assert.equal(health.url, 'http://ml.test');
    assert.equal(health.reason, 'ECONNABORTED');
  });
});

/* ------------------------------------------- revoked-grant handling tests */

describe('A grant Google has rejected', () => {
  const revokedClient = () => ({
    ...fakeClient(),
    refresh: async () => {
      const { GoogleHealthAuthError } = await import('../src/clients/googleHealthClient.js');
      throw new GoogleHealthAuthError('invalid_grant', { revoked: true });
    },
  });

  const flakyClient = () => ({
    ...fakeClient(),
    refresh: async () => {
      const { GoogleHealthAuthError } = await import('../src/clients/googleHealthClient.js');
      throw new GoogleHealthAuthError('socket hang up', { revoked: false });
    },
  });

  const expiredTokens = () => fakeUsers([{
    id: 'u0',
    googleHealth: {
      refreshToken: 'refresh',
      accessToken: 'stale',
      expiresAt: new Date(Date.now() - 1000),
    },
  }]);

  it('stops reporting as connected once the grant is revoked', async () => {
    const users = expiredTokens();
    const service = new GoogleHealthService({ client: revokedClient(), users });

    await assert.rejects(() => service.sync('u0', { days: 7 }));

    // In Testing mode Google expires refresh tokens after 7 days, so this is
    // the normal weekly state. A "Connected" badge over a dead grant is the UI
    // asserting something the server knows to be false.
    const status = await service.status('u0');
    assert.equal(status.connected, false);
    assert.equal(status.needsReconnect, true);
  });

  it('leaves the connection alone when the failure is transient', async () => {
    const users = expiredTokens();
    const service = new GoogleHealthService({ client: flakyClient(), users });

    await assert.rejects(() => service.sync('u0', { days: 7 }));

    // A socket hang up says nothing about the tokens. Disconnecting over one
    // would make the user reconnect for a hiccup.
    const status = await service.status('u0');
    assert.equal(status.connected, true);
    assert.equal(status.needsReconnect, false);
  });

  it('clears the flag once a reconnection works', async () => {
    const users = expiredTokens();
    users.rows[0].googleHealth.needsReconnect = true;
    const service = new GoogleHealthService({ client: fakeClient(), users });

    await service.sync('u0', { days: 7 });
    assert.equal(users.rows[0].googleHealth.needsReconnect, false);
    assert.equal((await service.status('u0')).connected, true);
  });
});
