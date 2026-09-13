/**
 * Read a Samsung Health export in the browser.
 *
 * The archive is what Samsung actually hands you — one `.zip`, so that is what
 * the app accepts. Not a folder: `webkitdirectory` is non-standard, unavailable
 * on mobile, and would ask the user to hand over 14,507 files when four of them
 * are wanted.
 *
 * Unzipped here rather than uploaded whole because the archive is ~23 MB and
 * almost all of it is raw JSON this project never reads. Extracting the four
 * CSVs and trimming them by date turns that into a couple of megabytes.
 *
 * **The browser extracts and filters; it never derives.** Every number comes
 * from the server parsing these bytes, the same rule that keeps meal macros
 * server-side: a client that computes health values is a client that can assert
 * them.
 */
import { unzipSync, strFromU8 } from 'fflate';

/** The four files worth extracting, by the fragment that identifies each. */
const WANTED = {
  pedometer: 'tracker.pedometer_day_summary',
  steps: 'step_daily_trend',
  sleep: 'com.samsung.shealth.sleep.',
  heartRate: 'tracker.heart_rate',
};

/**
 * How much history to send.
 *
 * An assessment scores 14 days and a trajectory walks 90, so a longer window
 * buys nothing the app can use. Measured on a real export, the cost of getting
 * this wrong is all in the heart-rate file: 400 days is 10.1 MB, 180 is 4.3,
 * and 120 is 2.9 -- the same answer, a third of someone's mobile data.
 */
const DEFAULT_WINDOW_DAYS = 120;

/** Matches the first calendar date on a row, whatever column it sits in. */
const ROW_DATE = /(\d{4}-\d{2}-\d{2})/;

/**
 * Keep the metadata line, the header, and rows inside the window.
 *
 * A pure text filter: rows are selected, never altered or summarised. The
 * heart-rate file is 47,378 samples over eighteen months, and an assessment
 * reads a 14-day window with trends over 90, so sending all of it would cost
 * megabytes to reach the same answer.
 */
function trimToWindow(text, cutoff) {
  if (!text) return text;
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, 2);
  const body = lines.slice(2).filter((line) => {
    if (!line.trim()) return false;
    const match = line.match(ROW_DATE);
    // A row with no recognisable date is kept: dropping it would be a judgement
    // the server is better placed to make.
    return !match || match[1] >= cutoff;
  });
  return [...head, ...body].join('\n');
}

export class NotASamsungExport extends Error {}

/**
 * Extract the CSVs this app reads from a Samsung Health archive.
 *
 * @param {File} file  the `.zip` from Samsung Health -> Settings -> Download personal data
 * @param {{ days?: number }} options
 */
export async function readSamsungExport(file, { days = DEFAULT_WINDOW_DAYS } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());

  let archive;
  try {
    archive = unzipSync(bytes, {
      // Skip the thousands of raw JSON blobs without decompressing them.
      filter: (entry) => entry.name.endsWith('.csv')
        && Object.values(WANTED).some((fragment) => entry.name.includes(fragment)),
    });
  } catch {
    throw new NotASamsungExport(
      'That file could not be read as a zip archive. Use the .zip exactly as Samsung '
      + 'Health exported it, without unzipping it first.',
    );
  }

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const files = {};
  const found = [];

  for (const [key, fragment] of Object.entries(WANTED)) {
    const name = Object.keys(archive).find((entry) => entry.includes(fragment));
    if (!name) continue;
    // fflate's decoder drops the UTF-8 BOM Samsung writes. That is fine, and
    // deliberately not relied upon: the server strips a BOM if one is present,
    // so the same parser reads both this path and a file handed over directly.
    files[key] = trimToWindow(strFromU8(archive[name]), cutoff);
    found.push(key);
  }

  if (!found.length) {
    throw new NotASamsungExport(
      'That zip does not contain the Samsung Health day-summary files. Export again from '
      + 'Samsung Health -> Settings -> Download personal data.',
    );
  }

  return { files, found, cutoff };
}

export default readSamsungExport;
