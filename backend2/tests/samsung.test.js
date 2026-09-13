/**
 * Samsung Health import tests.
 *
 * The fixtures are real bytes: the metadata line, the header and the last forty
 * rows of each file from an actual 23 MB export. Invented fixtures would have
 * agreed with my reading of the format, which is exactly what needs testing --
 * the metadata line, the trailing comma, and the two different time units are
 * all things a plausible-looking fake would have smoothed over.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

process.env.SESSION_SECRET ??= 'samsung-test-secret-key-long-enough';

const { SamsungHealthImportService, parseSamsungCsv } =
  await import('../src/services/samsungHealthImportService.js');
const { ValidationError } = await import('../src/domain/errors.js');

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/samsung-${name}.csv`, import.meta.url), 'utf8');

const EXPORT = {
  pedometer: fixture('pedometer'),
  steps: fixture('steps'),
  sleep: fixture('sleep'),
  heartRate: fixture('heartRate'),
};

describe('Samsung Health export', () => {
  it('reads the header from line 2, past the metadata line', () => {
    const rows = parseSamsungCsv(EXPORT.pedometer);
    assert.ok(rows.length > 0);
    // Taking line 1 as the header would name this column
    // "com.samsung.shealth.tracker.pedometer_day_summary".
    assert.ok('step_count' in rows[0], `columns were ${Object.keys(rows[0]).slice(0, 4)}`);
    assert.ok('active_time' in rows[0]);
  });

  it('still works if an export ever drops the metadata line', () => {
    const withoutPreamble = EXPORT.pedometer.split('\n').slice(1).join('\n');
    assert.ok('step_count' in parseSamsungCsv(withoutPreamble)[0]);
  });

  it('converts active_time from milliseconds to minutes', () => {
    const { days } = SamsungHealthImportService.parse(EXPORT);
    const withActive = days.filter((d) => d.active_minutes !== undefined);
    assert.ok(withActive.length > 0, 'expected active minutes in the fixture');
    for (const day of withActive) {
      // Reading the raw ms as minutes would put these in the tens of thousands.
      assert.ok(day.active_minutes <= 1440,
        `${day.date} has ${day.active_minutes} active minutes -- unit conversion is wrong`);
    }
  });

  it('reads sleep_duration as minutes and sums a fragmented night', () => {
    const { days } = SamsungHealthImportService.parse(EXPORT);
    const slept = days.filter((d) => d.sleep_hours !== undefined);
    assert.ok(slept.length > 0, 'expected sleep in the fixture');
    for (const day of slept) {
      assert.ok(day.sleep_hours > 0 && day.sleep_hours <= 24,
        `${day.date} has ${day.sleep_hours} hours of sleep`);
    }
  });

  it('weights sleep efficiency by duration, not by session count', () => {
    const sleep = [
      'com.samsung.shealth.sleep,7006011,11',
      'sleep_duration,efficiency,com.samsung.health.sleep.start_time,com.samsung.health.sleep.end_time',
      // Five hours at 90%, then a twenty-minute nap at 50%.
      '300,90,2026-09-12 23:00:00.000,2026-09-13 04:00:00.000',
      '20,50,2026-09-13 14:00:00.000,2026-09-13 14:20:00.000',
    ].join('\n');

    const { days } = SamsungHealthImportService.parse({ sleep });
    const [day] = days;

    assert.equal(day.sleep_hours, 5.33);            // 320 minutes
    // A plain mean would be 70. The long stretch should dominate.
    assert.equal(day.sleep_quality_score, 88);
  });

  it('takes the daily MINIMUM heart rate, never the mean', () => {
    const heartRate = [
      'com.samsung.shealth.tracker.heart_rate,7006011,3',
      'com.samsung.health.heart_rate.start_time,com.samsung.health.heart_rate.min,com.samsung.health.heart_rate.heart_rate',
      '2026-09-12 09:00:00.000,58,58',
      '2026-09-12 13:00:00.000,120,120',
      '2026-09-12 20:00:00.000,74,74',
    ].join('\n');

    const { days } = SamsungHealthImportService.parse({ heartRate });
    // 58, not the 84 mean: resting pulse is the quantity the model was fitted
    // on, and a mean daily heart rate is a different measurement.
    assert.equal(days[0].resting_heart_rate, 58);
  });

  it('leaves fields absent when a file is missing, never zero', () => {
    const { days, counts } = SamsungHealthImportService.parse({ pedometer: EXPORT.pedometer });
    assert.ok(days.length > 0);
    assert.equal(counts.sleep_hours, 0);
    for (const day of days) {
      assert.equal('sleep_hours' in day, false, 'no sleep file must not mean zero sleep');
      assert.equal('resting_heart_rate' in day, false);
    }
  });

  it('reports HRV as missing rather than deriving it from stress scores', () => {
    const result = SamsungHealthImportService.parse(EXPORT);
    assert.deepEqual(result.missing, ['heart_rate_variability']);
  });

  it('tags every day with its source and refuses an unusable export', () => {
    const { days, source, range } = SamsungHealthImportService.parse(EXPORT);
    assert.equal(source, 'samsung_health');
    assert.ok(days.every((d) => d.source === 'samsung_health'));
    assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);

    assert.throws(() => SamsungHealthImportService.parse({ sleep: 'not,a,samsung,export' }),
      ValidationError);
  });
});

describe('Real-file quirks the fixtures must preserve', () => {
  it('survives the UTF-8 BOM the export actually carries', () => {
    // The fixtures keep their BOM on purpose. An earlier cut of them stripped
    // it, so every test passed while the real 23 MB export produced zero days:
    // the BOM joined the first line, the metadata line stopped matching, and
    // the preamble was read as the header.
    assert.ok(EXPORT.pedometer.charCodeAt(0) === 0xFEFF,
      'the fixture must keep the BOM, or it stops testing what the export does');
    assert.ok('step_count' in parseSamsungCsv(EXPORT.pedometer)[0]);
  });
});
