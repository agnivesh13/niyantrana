/**
 * Samsung Health export importer.
 *
 * Samsung Health is the only route to real wearable data for a large share of
 * this project's intended users, and neither existing path reaches it: the
 * Google Health API serves a different store, and the generic aliased importer
 * cannot read this shape. So this reads the export directly.
 *
 * Four quirks of that format, each of which breaks a naive reader:
 *
 * 1. **The header is on line 2.** Line 1 is a metadata line —
 *    `com.samsung.shealth.step_daily_trend,7006011,6`. A normal CSV parser
 *    takes it as the header and every column name is wrong.
 * 2. **Rows carry a trailing comma**, so a 62-column header meets 63-field
 *    rows. Harmless once expected, misaligning if not.
 * 3. **Units differ per file.** `active_time` is milliseconds; `sleep_duration`
 *    is minutes. Reading either as the other is off by 60,000x or 60x, and
 *    nothing in the file says which.
 * 4. **Sleep is fragmented.** A night is several sessions plus naps, so a day's
 *    sleep is a sum, and its efficiency is a duration-weighted mean rather than
 *    an average of percentages.
 *
 * Column names and units here were read off a real 23 MB export (14,507
 * entries, 1,430 days of steps, 47,378 heart-rate samples), not from
 * documentation.
 */
import { ValidationError } from '../domain/errors.js';
import { parseCsv } from '../domain/csv.js';

const SOURCE = 'samsung_health';
const MS_PER_MINUTE = 60000;

/** Plausible bounds, matching the wearable schema. Outside these is a typo. */
const LIMITS = {
  daily_steps: [0, 200000],
  active_minutes: [0, 1440],
  sleep_hours: [0, 24],
  sleep_quality_score: [0, 100],
  resting_heart_rate: [20, 220],
};

/**
 * Samsung's per-file prefixes are inconsistent: `sleep_duration` sits bare
 * while the timestamps beside it are `com.samsung.health.sleep.start_time`.
 * Looking a column up by suffix removes that from every call site.
 */
const cell = (row, ...names) => {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name];
    const key = Object.keys(row).find((k) => k === name || k.endsWith(`.${name}`));
    if (key && row[key] !== '') return row[key];
  }
  return undefined;
};

const number = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** `2025-05-06 18:30:00.388` and `2025-05-06 00:00:00.000` both appear. */
const dateOf = (value) => {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

const minutesBetween = (start, end) => {
  const from = Date.parse(String(start).replace(' ', 'T'));
  const to = Date.parse(String(end).replace(' ', 'T'));
  return Number.isFinite(from) && Number.isFinite(to) ? (to - from) / MS_PER_MINUTE : null;
};

/**
 * The metadata line Samsung puts above the header.
 *
 * Shaped as a datatype name followed by version numbers:
 * `com.samsung.shealth.step_daily_trend,7006011,6`. Matched by that shape
 * rather than by "starts with com.samsung", because header lines start that way
 * too — `com.samsung.health.heart_rate.start_time` is a column name in the
 * heart-rate export. Only the metadata line is numeric in every field after the
 * first.
 */
const METADATA_LINE = /^com\.samsung\.[\w.]+(,\d+)+\s*$/;

/**
 * Parse one Samsung CSV, dropping the metadata line.
 *
 * Detected rather than assumed, so an export that ever stops emitting the
 * preamble still reads correctly.
 */
export function parseSamsungCsv(text) {
  if (!text || !text.trim()) return [];

  // Samsung writes a UTF-8 BOM. Left in place it becomes part of the first
  // line, so the metadata line stops matching, the preamble is read as the
  // header, and every column name is wrong -- which surfaces downstream as
  // "this export contains no usable days" rather than as a parse error. The
  // test fixtures keep their BOM for this reason.
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const start = METADATA_LINE.test(lines[0] ?? '') ? 1 : 0;
  return parseCsv(lines.slice(start).join('\n'));
}

export class SamsungHealthImportService {
  /**
   * Turn the extracted CSVs into wearable days.
   *
   * Every file is optional. An export without a watch has steps and no heart
   * rate; one without sleep tracking has neither sleep field. A missing file
   * leaves its fields absent rather than zero, because zero steps and no
   * pedometer are different facts and the model treats them differently.
   */
  static parse({ pedometer, steps, sleep, heartRate } = {}) {
    const byDate = new Map();
    const counts = {
      daily_steps: 0, active_minutes: 0, sleep_hours: 0,
      sleep_quality_score: 0, resting_heart_rate: 0,
    };

    /**
     * Record a value, reconciling the several rows a day can have.
     *
     * Samsung writes one row per device per day -- phone, watch, earbuds -- so
     * 495 of these 496 days arrive two or three times over. Last-write-wins
     * silently picked whichever device the file happened to list last, which
     * for one sample day meant reporting 7,636 steps when the day's total was
     * 8,417.
     *
     * `max` for steps and active minutes: summing would double-count the same
     * walk recorded by two devices, while the highest-reporting device is the
     * one that was actually worn. Measured against this export, the maximum
     * equals Samsung's own aggregate row (`source_type = -2`) on 495 of 495
     * multi-device days -- so this reproduces their reconciliation without
     * depending on an undocumented sentinel value.
     *
     * `min` for resting heart rate, for the reason given at its call site.
     */
    const RECONCILE = {
      daily_steps: Math.max,
      active_minutes: Math.max,
      resting_heart_rate: Math.min,
      sleep_hours: Math.max,
      sleep_quality_score: Math.max,
    };

    const put = (date, field, value) => {
      if (!date || value === null) return;
      const [min, max] = LIMITS[field];
      if (value < min || value > max) return;

      const day = byDate.get(date) ?? { date, source: SOURCE };
      if (day[field] === undefined) {
        counts[field] += 1;
        day[field] = value;
      } else {
        day[field] = RECONCILE[field](day[field], value);
      }
      byDate.set(date, day);
    };

    // --- Steps and active minutes -------------------------------------------
    // pedometer_day_summary carries both, so it is preferred; step_daily_trend
    // is the fallback for an export that lacks it.
    for (const row of parseSamsungCsv(pedometer)) {
      const date = dateOf(cell(row, 'day_time', 'create_time'));
      put(date, 'daily_steps', number(cell(row, 'step_count', 'count')));

      // Milliseconds. 1,292,020 is 21.5 minutes, not 21,533 of them.
      const activeMs = number(cell(row, 'active_time'));
      if (activeMs !== null) put(date, 'active_minutes', Math.round(activeMs / MS_PER_MINUTE));
    }

    for (const row of parseSamsungCsv(steps)) {
      const date = dateOf(cell(row, 'day_time', 'create_time'));
      put(date, 'daily_steps', number(cell(row, 'count', 'step_count')));
    }

    // --- Sleep ---------------------------------------------------------------
    // Summed across sessions, and attributed to the date the user woke, which
    // is the night people mean when they say "last night's sleep".
    const nights = new Map();
    for (const row of parseSamsungCsv(sleep)) {
      const end = cell(row, 'end_time');
      const start = cell(row, 'start_time');
      const date = dateOf(end) ?? dateOf(start);
      if (!date) continue;

      const minutes = number(cell(row, 'sleep_duration'))
        ?? (start && end ? minutesBetween(start, end) : null);
      if (minutes === null || minutes <= 0) continue;

      const night = nights.get(date) ?? { minutes: 0, weighted: 0, weight: 0 };
      night.minutes += minutes;

      // Duration-weighted: a 52-minute nap at 88% should not pull the night's
      // efficiency around as hard as a five-hour stretch.
      const efficiency = number(cell(row, 'efficiency', 'original_efficiency'));
      if (efficiency !== null && efficiency > 0) {
        night.weighted += efficiency * minutes;
        night.weight += minutes;
      }
      nights.set(date, night);
    }

    for (const [date, night] of nights) {
      put(date, 'sleep_hours', Number((night.minutes / 60).toFixed(2)));
      if (night.weight > 0) {
        put(date, 'sleep_quality_score', Math.round(night.weighted / night.weight));
      }
    }

    // --- Resting heart rate --------------------------------------------------
    // The daily MINIMUM of the samples, which is a defensible proxy for resting
    // pulse and the quantity the model was fitted on. The mean would be a
    // different measurement wearing the same name.
    const lowest = new Map();
    for (const row of parseSamsungCsv(heartRate)) {
      const date = dateOf(cell(row, 'start_time', 'create_time'));
      const bpm = number(cell(row, 'min', 'heart_rate'));
      if (!date || bpm === null || bpm < LIMITS.resting_heart_rate[0]) continue;
      const current = lowest.get(date);
      if (current === undefined || bpm < current) lowest.set(date, bpm);
    }
    for (const [date, bpm] of lowest) put(date, 'resting_heart_rate', Math.round(bpm));

    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (!days.length) {
      throw new ValidationError(
        'No usable days were found in that export. Check that the zip is a Samsung Health '
        + 'export and contains the day-summary and sleep files.',
      );
    }

    return {
      days,
      counts,
      source: SOURCE,
      range: { from: days[0].date, to: days[days.length - 1].date },
      // Samsung does not export HRV in any form this reads, so the feature is
      // absent rather than guessed at from stress scores, which are a different
      // quantity derived by an undocumented algorithm.
      missing: ['heart_rate_variability'],
    };
  }
}

export default SamsungHealthImportService;
